import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename, normalize } from 'node:path';
import { login, scan } from './helpers';
import { startDirectoryServer, type DirectoryTestServer } from './directory-server';

let server: DirectoryTestServer;
const configurationPath = '/api/v1/admin/plugin-instances/local/configuration';
const directoryPath = '/api/v1/admin/plugin-instances/local/directories';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await startDirectoryServer();
});
test.afterAll(async () => { await server?.stop(); });

async function configuration(api: APIRequestContext) {
  const response = await api.get(server.origin + configurationPath);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function runtimeState(api: APIRequestContext): Promise<string> {
  const response = await api.get(`${server.origin}/api/v1/admin/plugins`);
  expect(response.ok()).toBeTruthy();
  const snapshot = await response.json();
  return snapshot.items.find((plugin: { pluginId: string }) => plugin.pluginId === 'musicfs.localfiles')
    .instances.find((instance: { instanceId: string }) => instance.instanceId === 'local').runtimeState;
}

test('administrator directory browser exposes only authorized directories', async ({ page, request }) => {
  expect((await request.get(server.origin + directoryPath)).status()).toBe(401);
  await login(page, server);
  expect((await configuration(page.request)).roots).toEqual([]);
  expect(await runtimeState(page.request)).toBe('pending_configuration');
  const rootsResponse = await page.request.get(server.origin + directoryPath);
  expect(rootsResponse.ok()).toBeTruthy();
  const roots = await rootsResponse.json();
  expect(roots.path).toBeNull();
  expect(roots.parentPath).toBeNull();
  expect(roots.configuredRootId).toBeNull();
  expect(roots.items).toEqual([{ name: basename(server.allowedRoot), path: server.allowedRoot, available: true, configuredRootId: null }]);
  const children = await page.request.get(server.origin + directoryPath, { params: { path: server.allowedRoot } });
  expect(children.ok()).toBeTruthy();
  const directories = await children.json();
  expect(normalize(directories.path)).toBe(server.allowedRoot);
  expect(directories.parentPath).toBeNull();
  expect(directories.configuredRootId).toBeNull();
  expect(directories.items).toEqual([{ name: basename(server.selectedRoot), path: server.selectedRoot, available: true, configuredRootId: null }]);
  const forbidden = await page.request.get(server.origin + directoryPath, { params: { path: server.outsideRoot } });
  expect(forbidden.status()).toBe(403);
  expect((await forbidden.json()).error.code).toBe('ACCESS_DENIED');
  expect(readFileSync(server.configPath, 'utf8')).toBe(server.configuration);
});

test('settings selects a child directory, saves without importing, and preserves cleared configuration after restart', async ({ page }, info) => {
  test.setTimeout(120_000);
  await login(page, server);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '管理音乐目录', exact: true }).click();
  const panel = page.locator('.local-directories');
  await panel.getByRole('button', { name: `打开目录 ${basename(server.allowedRoot)}`, exact: true }).click();
  await expect(panel.getByRole('list', { name: '可选目录', exact: true })).not.toContainText('unselected.wav');
  await panel.getByRole('button', { name: `打开目录 ${basename(server.selectedRoot)}`, exact: true }).click();
  await expect(panel.getByText('此目录没有可浏览的子目录。', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '添加当前目录', exact: true }).click();
  await expect(panel.getByRole('list', { name: '已选音乐目录', exact: true }).getByRole('listitem')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: '添加当前目录', exact: true })).toBeDisabled();
  await panel.screenshot({ path: info.outputPath('directory-selection.png') });
  const [saved] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(configurationPath) && response.request().method() === 'PUT'),
    panel.getByRole('button', { name: '保存音乐目录', exact: true }).click(),
  ]);
  expect(saved.status()).toBe(202);
  expect(saved.request().postDataJSON().musicRoots).toEqual([{
    id: expect.any(String), name: basename(server.selectedRoot), path: server.selectedRoot,
  }]);
  await expect(panel.getByText('音乐目录已保存。', { exact: false })).toBeVisible();
  await expect.poll(() => runtimeState(page.request)).toBe('ready');
  const configured = await configuration(page.request);
  expect(configured.roots).toEqual([{
    id: saved.request().postDataJSON().musicRoots[0].id,
    name: basename(server.selectedRoot), pathConfigured: true,
  }]);
  await panel.getByRole('button', { name: `打开目录 ${basename(server.allowedRoot)}`, exact: true }).click();
  await expect(panel.getByRole('button', { name: `添加目录 ${basename(server.selectedRoot)}`, exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: `打开目录 ${basename(server.selectedRoot)}`, exact: true }).click();
  await expect(panel.getByRole('button', { name: '添加当前目录', exact: true })).toBeDisabled();
  const savedDirectoryResponse = await page.request.get(server.origin + directoryPath, { params: { path: server.selectedRoot } });
  expect(savedDirectoryResponse.ok()).toBeTruthy();
  expect((await savedDirectoryResponse.json()).configuredRootId).toBe(configured.roots[0].id);
  await panel.getByRole('button', { name: `移除目录 ${basename(server.selectedRoot)}`, exact: true }).click();
  await expect(panel.getByRole('button', { name: '保存音乐目录', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: '添加当前目录', exact: true }).click();
  await expect(panel.getByRole('list', { name: '已选音乐目录', exact: true }).getByRole('listitem')).toHaveCount(1);
  await expect(panel.getByRole('list', { name: '已选音乐目录', exact: true })).toContainText(configured.roots[0].name);
  await expect(panel.getByRole('button', { name: '保存音乐目录', exact: true })).toBeDisabled();
  expect((await configuration(page.request)).roots).toEqual(configured.roots);
  const sourceTracks = async () => {
    const response = await page.request.get(`${server.origin}/api/v1/source-tracks`);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).items;
  };
  expect(await sourceTracks()).toEqual([]);
  expect(readFileSync(server.configPath, 'utf8')).toBe(server.configuration);
  await scan(page.request, server.origin);
  const imported = await sourceTracks();
  expect(imported).toHaveLength(1);
  expect(imported[0].displayName).toBe('selected.wav');
  await panel.getByRole('button', { name: '清空选择', exact: true }).click();
  await panel.getByRole('button', { name: '保存音乐目录', exact: true }).click();
  await expect(panel.getByText('音乐目录已保存。', { exact: false })).toBeVisible();
  await expect.poll(() => runtimeState(page.request)).toBe('pending_configuration');
  expect((await configuration(page.request)).roots).toEqual([]);
  expect(await sourceTracks()).toHaveLength(1);
  await panel.screenshot({ path: info.outputPath('directory-cleared.png') });
  await server.restart();
  await page.reload();
  await expect(page.getByRole('button', { name: '账号菜单' })).toBeVisible();
  expect(await runtimeState(page.request)).toBe('pending_configuration');
  expect((await configuration(page.request)).roots).toEqual([]);
  expect(await sourceTracks()).toHaveLength(1);
  expect(readFileSync(server.configPath, 'utf8')).toBe(server.configuration);
});
