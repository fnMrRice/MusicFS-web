import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename, normalize } from 'node:path';
import { login, scan } from './helpers';
import { startDirectoryServer, type DirectoryTestServer } from './directory-server';
import { instanceIds } from '../fixtures/plugins';

let server: DirectoryTestServer;
const configurationPath = `/api/v1/admin/plugin-instances/${instanceIds.local}/configuration`;
const directoryPath = `/api/v1/admin/plugin-instances/${instanceIds.local}/directories`;

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
  return snapshot.items.find((plugin: { pluginId: string }) => plugin.pluginId === 'musicfs.plugin.source.localfiles')
    .instances.find((instance: { instanceId: string }) => instance.instanceId === instanceIds.local).runtimeState;
}

async function openManager(page: Page) {
  await page.getByRole('button', { name: '管理目录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '管理目录', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tree', { name: '允许访问的目录', exact: true })).toBeVisible();
  return dialog;
}

async function expand(dialog: Locator, path: string) {
  await dialog.getByRole('button', { name: `展开目录 ${basename(path)}`, exact: true }).click();
  await expect(dialog.getByRole('button', { name: `收起目录 ${basename(path)}`, exact: true })).toBeVisible();
}

function select(dialog: Locator, path: string) {
  return dialog.getByRole('checkbox', { name: `选择目录 ${basename(path)}`, exact: true });
}

async function advanced(dialog: Locator) {
  await dialog.getByText('高级选项', { exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: '限制递归深度', exact: true })).toBeVisible();
}

async function save(page: Page, dialog: Locator) {
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(configurationPath) && response.request().method() === 'PUT'),
    dialog.getByRole('button', { name: '保存', exact: true }).click(),
  ]);
  expect(response.status()).toBe(202);
  await expect(dialog).toHaveCount(0);
  return response.request().postDataJSON();
}

async function importedNames(api: APIRequestContext): Promise<string[]> {
  const response = await api.get(`${server.origin}/api/v1/source-tracks`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).items.map((item: { displayName: string }) => item.displayName).sort();
}

test('administrator tree roots expose only allowed server directories', async ({ page, request }) => {
  expect((await request.get(server.origin + directoryPath)).status()).toBe(401);
  await login(page, server);
  const defaults = await configuration(page.request);
  expect(defaults.roots).toEqual([]);
  expect(defaults.importOptions.importDefaults).toMatchObject({ recursive: true, maxDepth: 0, skipHidden: true, respectNoMedia: true });
  expect(await runtimeState(page.request)).toBe('pending_configuration');
  const rootsResponse = await page.request.get(server.origin + directoryPath);
  expect(rootsResponse.ok()).toBeTruthy();
  const roots = await rootsResponse.json();
  expect(roots.path).toBeNull();
  expect(roots.parentPath).toBeNull();
  expect(roots.configuredRootId).toBeNull();
  expect(roots.items).toEqual([server.allowedRoot, server.secondAllowedRoot].map(path => ({
    name: basename(path), path, available: true, configuredRootId: null,
  })));
  const children = await page.request.get(server.origin + directoryPath, { params: { path: server.allowedRoot } });
  expect(children.ok()).toBeTruthy();
  const directories = await children.json();
  expect(normalize(directories.path)).toBe(server.allowedRoot);
  expect(directories.parentPath).toBeNull();
  expect(directories.items).toEqual([{
    name: basename(server.selectedRoot), path: server.selectedRoot, available: true, configuredRootId: null,
  }]);
  const forbidden = await page.request.get(server.origin + directoryPath, { params: { path: server.outsideRoot } });
  expect(forbidden.status()).toBe(403);
  expect((await forbidden.json()).error.code).toBe('ACCESS_DENIED');
  expect(readFileSync(server.configPath, 'utf8')).toBe(server.configuration);
});

test('directory tree saves multiple subdirectories and applies disabled, limited and unlimited recursion', async ({ page }, info) => {
  test.setTimeout(120_000);
  await login(page, server);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const heading = page.getByRole('heading', { name: '本地音乐', exact: true });
  await expect(heading).toBeVisible();
  await expect(page.getByRole('heading', { name: '未知来源', exact: true })).toHaveCount(0);
  await expect(page.getByText('暂无已选择目录', { exact: true })).toBeVisible();
  const manage = page.getByRole('button', { name: '管理目录', exact: true });
  const titleBounds = (await heading.boundingBox())!;
  const manageBounds = (await manage.boundingBox())!;
  expect(manageBounds.x).toBeGreaterThan(titleBounds.x + titleBounds.width);
  expect(Math.abs(manageBounds.y + manageBounds.height / 2 - titleBounds.y - titleBounds.height / 2)).toBeLessThan(10);
  let dialog = await openManager(page);
  const recursive = () => dialog.getByRole('checkbox', { name: '递归查找子目录', exact: true });
  const limit = () => dialog.getByRole('checkbox', { name: '限制递归深度', exact: true });
  const depth = () => dialog.getByRole('spinbutton', { name: '递归深度', exact: true });
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await expect(recursive()).toBeChecked();
  await expect(dialog.getByLabel('限制递归深度', { exact: true })).not.toBeVisible();
  await advanced(dialog);
  await expect(limit()).not.toBeChecked();
  await expect(depth()).toHaveValue('0');
  await expect(depth()).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: '包含隐藏文件和目录', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '遵循 .nomedia 标记', exact: true })).toBeChecked();
  await expect(dialog.getByRole('treeitem')).toHaveCount(2);
  await expect(select(dialog, server.allowedRoot)).not.toBeChecked();
  await select(dialog, server.allowedRoot).check();
  await recursive().uncheck();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(manage).toBeFocused();
  expect((await configuration(page.request)).roots).toEqual([]);
  dialog = await openManager(page);
  await expect(select(dialog, server.allowedRoot)).not.toBeChecked();
  await expect(recursive()).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(manage).toBeFocused();
  dialog = await openManager(page);
  await advanced(dialog);
  await expand(dialog, server.allowedRoot);
  await expect(select(dialog, server.selectedRoot)).toBeVisible();
  await expect(dialog.getByRole('tree')).not.toContainText('unselected.wav');
  await dialog.getByRole('button', { name: `收起目录 ${basename(server.allowedRoot)}`, exact: true }).click();
  await expect(select(dialog, server.selectedRoot)).not.toBeVisible();
  await expand(dialog, server.allowedRoot);
  await select(dialog, server.selectedRoot).check();
  await expand(dialog, server.secondAllowedRoot);
  await select(dialog, server.secondSelectedRoot).check();
  await expect(select(dialog, server.allowedRoot)).not.toBeChecked();
  await expect(select(dialog, server.secondAllowedRoot)).not.toBeChecked();
  await dialog.getByText('高级选项', { exact: true }).click();
  await expect(dialog.getByLabel('限制递归深度', { exact: true })).not.toBeVisible();
  await dialog.screenshot({ path: info.outputPath('directory-tree.png') });
  await advanced(dialog);
  await recursive().uncheck();
  await expect(limit()).toBeDisabled();
  await expect(depth()).toBeDisabled();
  expect((await configuration(page.request)).roots).toEqual([]);
  const saved = await save(page, dialog);
  expect(saved.musicRoots).toEqual([server.selectedRoot, server.secondSelectedRoot].map(path => ({
    id: expect.any(String), name: basename(path), path,
  })));
  expect(saved.importDefaults).toMatchObject({ recursive: false, maxDepth: 0 });
  await expect.poll(() => runtimeState(page.request)).toBe('ready');
  await expect(page.getByText('暂无已选择目录', { exact: true })).toHaveCount(0);
  const selected = page.getByRole('list', { name: '已选音乐目录', exact: true });
  await expect(selected.getByRole('listitem')).toHaveCount(2);
  await expect(selected).toContainText(basename(server.selectedRoot));
  await expect(selected).toContainText(basename(server.secondSelectedRoot));
  const configured = await configuration(page.request);
  expect(configured.roots.map((root: { id: string }) => root.id)).toEqual(saved.musicRoots.map((root: { id: string }) => root.id));
  expect(configured.importOptions.importDefaults).toMatchObject({ recursive: false, maxDepth: 0 });
  expect(await importedNames(page.request)).toEqual([]);
  await scan(page.request, server.origin);
  expect(await importedNames(page.request)).toEqual(['second-selected.wav', 'selected.wav']);
  dialog = await openManager(page);
  await advanced(dialog);
  await expand(dialog, server.allowedRoot);
  await expand(dialog, server.secondAllowedRoot);
  await expect(select(dialog, server.selectedRoot)).toBeChecked();
  await expect(select(dialog, server.secondSelectedRoot)).toBeChecked();
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await select(dialog, server.selectedRoot).uncheck();
  await select(dialog, server.selectedRoot).check();
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await recursive().check();
  await expect(limit()).not.toBeChecked();
  await expect(depth()).toBeDisabled();
  await limit().check();
  await expect(depth()).toBeEnabled();
  await expect(depth()).toHaveValue('1');
  const limited = await save(page, dialog);
  expect(limited.importDefaults).toMatchObject({ recursive: true, maxDepth: 1 });
  expect(limited.musicRoots).toHaveLength(configured.roots.length);
  expect(limited.musicRoots).toEqual(expect.arrayContaining(configured.roots.map(({ id, name }: { id: string; name: string }) => ({ id, name }))));
  expect((await configuration(page.request)).importOptions.importDefaults).toMatchObject({ recursive: true, maxDepth: 1 });
  await scan(page.request, server.origin);
  expect(await importedNames(page.request)).toEqual(['depth-one.wav', 'second-selected.wav', 'selected.wav']);
  dialog = await openManager(page);
  await advanced(dialog);
  await expect(limit()).toBeChecked();
  await expect(depth()).toHaveValue('1');
  await recursive().uncheck();
  await expect(limit()).toBeDisabled();
  await recursive().check();
  await expect(limit()).not.toBeChecked();
  await expect(depth()).toHaveValue('0');
  await limit().check();
  await expect(depth()).toHaveValue('1');
  await limit().uncheck();
  await expect(depth()).toBeDisabled();
  await dialog.screenshot({ path: info.outputPath('directory-unlimited.png') });
  const unlimited = await save(page, dialog);
  expect(unlimited.importDefaults).toMatchObject({ recursive: true, maxDepth: 0 });
  await server.restart();
  await page.reload();
  await expect(manage).toBeVisible();
  expect((await configuration(page.request)).importOptions.importDefaults).toMatchObject({ recursive: true, maxDepth: 0 });
  await scan(page.request, server.origin);
  expect(await importedNames(page.request)).toEqual(['depth-one.wav', 'depth-two.wav', 'second-selected.wav', 'selected.wav']);
  dialog = await openManager(page);
  await advanced(dialog);
  await expect(limit()).not.toBeChecked();
  await expect(depth()).toHaveValue('0');
  await dialog.getByRole('checkbox', { name: '包含隐藏文件和目录', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '遵循 .nomedia 标记', exact: true }).uncheck();
  await dialog.screenshot({ path: info.outputPath('directory-advanced.png') });
  const includeAll = await save(page, dialog);
  expect(includeAll.importDefaults).toMatchObject({ recursive: true, maxDepth: 0, skipHidden: false, respectNoMedia: false });
  expect(await importedNames(page.request)).toHaveLength(4);
  await scan(page.request, server.origin);
  expect(await importedNames(page.request)).toEqual(['.hidden.wav', 'depth-one.wav', 'depth-two.wav', 'hidden-child.wav', 'nomedia.wav', 'second-selected.wav', 'selected.wav']);
  await server.restart();
  await page.reload();
  dialog = await openManager(page);
  await advanced(dialog);
  await expect(dialog.getByRole('checkbox', { name: '包含隐藏文件和目录', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '遵循 .nomedia 标记', exact: true })).not.toBeChecked();
  await expand(dialog, server.allowedRoot);
  await expand(dialog, server.secondAllowedRoot);
  await select(dialog, server.selectedRoot).uncheck();
  await select(dialog, server.secondSelectedRoot).uncheck();
  await save(page, dialog);
  await expect(page.getByText('暂无已选择目录', { exact: true })).toBeVisible();
  await expect.poll(() => runtimeState(page.request)).toBe('pending_configuration');
  expect((await configuration(page.request)).roots).toEqual([]);
  expect(await importedNames(page.request)).toHaveLength(7);
  await server.restart();
  await page.reload();
  await expect(page.getByText('暂无已选择目录', { exact: true })).toBeVisible();
  expect((await configuration(page.request)).roots).toEqual([]);
  expect(await importedNames(page.request)).toHaveLength(7);
  expect(readFileSync(server.configPath, 'utf8')).toBe(server.configuration);
  await page.locator('.settings-card').filter({ has: heading }).screenshot({ path: info.outputPath('directory-empty.png') });
});
