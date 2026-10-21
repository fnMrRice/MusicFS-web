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

async function localPlugin(api: APIRequestContext) {
  const response = await api.get(`${server.origin}/api/v1/admin/plugins`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).items.find((plugin: { pluginId: string }) => plugin.pluginId === 'musicfs.plugin.source.localfiles');
}

async function runtimeState(api: APIRequestContext): Promise<string> {
  return (await localPlugin(api)).instances.find((instance: { instanceId: string }) => instance.instanceId === instanceIds.local).runtimeState;
}

async function openAdd(page: Page) {
  await page.getByRole('button', { name: '添加本地目录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加本地目录', exact: true });
  await expect(dialog.getByRole('tree', { name: '允许访问的目录', exact: true })).toBeVisible();
  return dialog;
}

async function openEdit(page: Page, name: string) {
  await page.getByRole('button', { name: `编辑目录 ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑目录配置', exact: true });
  await expect(dialog.getByRole('checkbox', { name: '递归查找子目录', exact: true })).toBeVisible();
  await expect(dialog.getByRole('tree')).toHaveCount(0);
  return dialog;
}

async function openDelete(page: Page, name: string) {
  await page.getByRole('button', { name: `删除目录 ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除本地目录', exact: true });
  await expect(dialog).toBeVisible();
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

async function save(page: Page, dialog: Locator, action = '保存') {
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(configurationPath) && response.request().method() === 'PUT'),
    dialog.getByRole('button', { name: action, exact: true }).click(),
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

async function expectAllowedCount(page: Page) {
  expect((await localPlugin(page.request)).displayCount.value).toBe(2);
  await page.getByRole('tab', { name: '插件管理', exact: true }).click();
  const entry = page.locator('.plugin-entry').filter({ has: page.getByText('musicfs.plugin.source.localfiles', { exact: true }) });
  await expect(entry.locator('.plugin-count')).toHaveText('2 个允许访问的目录');
  await page.getByRole('tab', { name: '音乐源', exact: true }).click();
}

test('administrator tree exposes allowed directories independently of configured music directories', async ({ page, request }) => {
  expect((await request.get(server.origin + directoryPath)).status()).toBe(401);
  await login(page, server);
  const defaults = await configuration(page.request);
  expect(defaults.roots).toEqual([]);
  expect(defaults.rootImportDefaultsSupported).toBe(true);
  expect(defaults.importOptions.importDefaults).toMatchObject({ recursive: true, maxDepth: 0, skipHidden: true, respectNoMedia: true });
  expect(await runtimeState(page.request)).toBe('pending_configuration');
  expect((await localPlugin(page.request)).displayCount.value).toBe(2);
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

test('added directories support isolated configuration, cancellation, deletion and restart persistence', async ({ page }, info) => {
  test.setTimeout(180_000);
  await login(page, server);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const heading = page.getByRole('heading', { name: '本地音乐', exact: true });
  await expect(heading).toBeVisible();
  await expect(page.getByText('暂无已添加目录', { exact: true })).toBeVisible();
  await expectAllowedCount(page);
  const add = page.getByRole('button', { name: '添加本地目录', exact: true });
  const titleBounds = (await heading.boundingBox())!;
  const addBounds = (await add.boundingBox())!;
  expect(addBounds.x).toBeGreaterThan(titleBounds.x + titleBounds.width);
  expect(Math.abs(addBounds.y + addBounds.height / 2 - titleBounds.y - titleBounds.height / 2)).toBeLessThan(10);
  let dialog = await openAdd(page);
  const recursive = () => dialog.getByRole('checkbox', { name: '递归查找子目录', exact: true });
  const limit = () => dialog.getByRole('checkbox', { name: '限制递归深度', exact: true });
  const depth = () => dialog.getByRole('spinbutton', { name: '递归深度', exact: true });
  await expect(dialog.getByRole('button', { name: '添加所选目录', exact: true })).toBeDisabled();
  await expect(recursive()).toBeChecked();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.getByRole('treeitem')).toHaveCount(2);
  await expect(select(dialog, server.allowedRoot)).not.toBeChecked();
  await select(dialog, server.allowedRoot).check();
  await recursive().uncheck();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  expect((await configuration(page.request)).roots).toEqual([]);
  dialog = await openAdd(page);
  await expect(select(dialog, server.allowedRoot)).not.toBeChecked();
  await expect(recursive()).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  dialog = await openAdd(page);
  await advanced(dialog);
  await expect(limit()).not.toBeChecked();
  await expect(depth()).toHaveValue('0');
  await expect(depth()).toBeDisabled();
  await expand(dialog, server.allowedRoot);
  await expect(dialog.getByRole('tree')).not.toContainText('unselected.wav');
  await select(dialog, server.selectedRoot).check();
  await expand(dialog, server.secondAllowedRoot);
  await select(dialog, server.secondSelectedRoot).check();
  await expect(select(dialog, server.allowedRoot)).not.toBeChecked();
  await expect(select(dialog, server.secondAllowedRoot)).not.toBeChecked();
  await recursive().uncheck();
  await expect(limit()).toBeDisabled();
  await dialog.screenshot({ path: info.outputPath('directory-add.png') });
  const added = await save(page, dialog, '添加所选目录');
  expect(added.musicRoots).toEqual([server.selectedRoot, server.secondSelectedRoot].map(path => ({
    id: expect.any(String), name: basename(path), path,
    importDefaults: expect.objectContaining({ recursive: false, maxDepth: 0 }),
  })));
  expect(added.importDefaults).toMatchObject({ recursive: true, maxDepth: 0 });
  await expect.poll(() => runtimeState(page.request)).toBe('ready');
  const selected = page.getByRole('list', { name: '已添加的目录', exact: true });
  await expect(selected.getByRole('listitem')).toHaveCount(2);
  const firstName = basename(server.selectedRoot);
  const secondName = basename(server.secondSelectedRoot);
  for (const name of [firstName, secondName]) {
    await expect(selected.getByRole('button', { name: `删除目录 ${name}`, exact: true })).toHaveText('−');
    await expect(selected.getByRole('button', { name: `编辑目录 ${name}`, exact: true })).toBeVisible();
  }
  await page.locator('.settings-card').filter({ has: heading }).screenshot({ path: info.outputPath('directory-added-list.png') });
  await expectAllowedCount(page);
  await scan(page.request, server.origin);
  expect(await importedNames(page.request)).toEqual(['second-selected.wav', 'selected.wav']);
  dialog = await openAdd(page);
  await expand(dialog, server.allowedRoot);
  await expand(dialog, server.secondAllowedRoot);
  for (const path of [server.selectedRoot, server.secondSelectedRoot]) {
    await expect(select(dialog, path)).toBeChecked();
    await expect(select(dialog, path)).toBeDisabled();
  }
  await expect(dialog.getByRole('button', { name: /删除目录|移除目录/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '添加所选目录', exact: true })).toBeDisabled();
  await select(dialog, server.allowedRoot).check();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect((await configuration(page.request)).roots).toHaveLength(2);
  dialog = await openEdit(page, firstName);
  await recursive().check();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect((await configuration(page.request)).roots[0].importDefaults.recursive).toBe(false);
  dialog = await openEdit(page, firstName);
  await expect(recursive()).not.toBeChecked();
  await recursive().check();
  await advanced(dialog);
  await limit().check();
  await expect(depth()).toHaveValue('1');
  const limited = await save(page, dialog);
  expect(limited.musicRoots[0]).toMatchObject({ id: added.musicRoots[0].id, importDefaults: { recursive: true, maxDepth: 1 } });
  expect(limited.musicRoots[1]).toEqual({ id: added.musicRoots[1].id, name: secondName });
  expect((await configuration(page.request)).roots[1].importDefaults).toEqual(added.musicRoots[1].importDefaults);
  expect(limited.musicRoots.every((root: { path?: string }) => root.path === undefined)).toBe(true);
  expect(limited.importDefaults).toEqual(added.importDefaults);
  await scan(page.request, server.origin);
  expect(await importedNames(page.request)).toEqual(['depth-one.wav', 'second-selected.wav', 'selected.wav']);
  dialog = await openEdit(page, firstName);
  await advanced(dialog);
  await expect(limit()).toBeChecked();
  await limit().uncheck();
  await expect(depth()).toBeDisabled();
  await dialog.getByRole('checkbox', { name: '包含隐藏文件和目录', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '遵循 .nomedia 标记', exact: true }).uncheck();
  await dialog.screenshot({ path: info.outputPath('directory-edit.png') });
  const unlimited = await save(page, dialog);
  expect(unlimited.musicRoots[0].importDefaults).toMatchObject({ recursive: true, maxDepth: 0, skipHidden: false, respectNoMedia: false });
  expect(unlimited.musicRoots[1]).toEqual(limited.musicRoots[1]);
  await server.restart();
  await page.reload();
  await expect(selected.getByRole('listitem')).toHaveCount(2);
  const persisted = await configuration(page.request);
  expect(persisted.roots[0].importDefaults).toEqual(unlimited.musicRoots[0].importDefaults);
  expect(persisted.roots[1].importDefaults).toEqual(added.musicRoots[1].importDefaults);
  await scan(page.request, server.origin);
  expect(await importedNames(page.request)).toEqual(['.hidden.wav', 'depth-one.wav', 'depth-two.wav', 'hidden-child.wav', 'nomedia.wav', 'second-selected.wav', 'selected.wav']);
  dialog = await openDelete(page, firstName);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect((await configuration(page.request)).roots).toHaveLength(2);
  dialog = await openDelete(page, firstName);
  const removed = await save(page, dialog, '删除');
  expect(removed.musicRoots).toEqual([unlimited.musicRoots[1]]);
  await expect(selected.getByRole('listitem')).toHaveCount(1);
  await expectAllowedCount(page);
  await server.restart();
  await page.reload();
  await expect(selected.getByRole('listitem')).toHaveCount(1);
  dialog = await openDelete(page, secondName);
  await save(page, dialog, '删除');
  await expect(page.getByText('暂无已添加目录', { exact: true })).toBeVisible();
  await expect.poll(() => runtimeState(page.request)).toBe('pending_configuration');
  expect((await configuration(page.request)).roots).toEqual([]);
  await expectAllowedCount(page);
  await server.restart();
  await page.reload();
  await expect(page.getByText('暂无已添加目录', { exact: true })).toBeVisible();
  expect((await configuration(page.request)).roots).toEqual([]);
  expect(readFileSync(server.configPath, 'utf8')).toBe(server.configuration);
  await page.locator('.settings-card').filter({ has: heading }).screenshot({ path: info.outputPath('directory-empty.png') });
});
