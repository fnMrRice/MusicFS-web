import { test, expect, type Page, type Route } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';

let server: PreviewServer;
const origin = 'http://127.0.0.1:18141';
const root = 'D:\\Fixture Music';
const child = `${root}\\Collection`;
const rootItem = { name: 'Fixture Music', path: root, available: true, configuredRootId: null };
const childItem = { name: 'Collection', path: child, available: true, configuredRootId: null };

test.beforeAll(async () => {
  server = await preview({ preview: { host: '127.0.0.1', port: 18141, strictPort: true } });
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

function directoryPage(path: string | null, items: unknown[], nextCursor: string | null = null) {
  return { revision: 'mock-revision', path, parentPath: null, configuredRootId: null, items, nextCursor };
}

async function mockApi(page: Page, directories: (route: Route, url: URL) => Promise<void>, role = 'admin') {
  const requested: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    requested.push(path);
    if (path.endsWith('/directories')) return directories(route, url);
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', apiVersion: '1', ready: true, instanceId: 'mock-directories' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'test', user: { id: role, role } };
    if (path.endsWith('/provider-instances')) json = { items: [{
      id: 'local', name: 'Fixture', availability: 'unavailable',
      plugin: { id: 'musicfs.localfiles', name: 'Local files', localizedNames: { 'zh-CN': '本地音乐' }, features: ['music-source'] },
    }] };
    if (path.endsWith('/admin/plugins')) json = { items: [{
      pluginId: 'musicfs.localfiles', instances: [{ instanceId: 'local', name: 'Fixture', runtimeState: 'pending_configuration' }],
    }] };
    if (path.endsWith('/configuration')) json = {
      revision: 'mock-revision', roots: [],
      importOptions: { importDefaults: { recursive: true, maxDepth: 0, skipHidden: true, respectNoMedia: true, excludePatterns: [] } },
    };
    await route.fulfill({ json });
  });
  return requested;
}

async function openDirectories(page: Page) {
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '管理目录', exact: true }).click();
  return page.getByRole('dialog', { name: '管理目录', exact: true });
}

test('mock directory pagination continues after an empty page', async ({ page }) => {
  const cursors: (string | null)[] = [];
  await mockApi(page, async (route, url) => {
    const cursor = url.searchParams.get('cursor');
    cursors.push(cursor);
    await route.fulfill({ json: cursor === null
      ? directoryPage(null, [], 'roots-next') : directoryPage(null, [rootItem]) });
  });
  const panel = await openDirectories(page);
  await expect(panel.getByRole('tree', { name: '允许访问的目录', exact: true }).getByRole('treeitem')).toHaveCount(0);
  await expect(panel.getByText('没有允许访问的目录，请在服务端配置目录访问权限。', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '加载更多目录', exact: true }).click();
  await expect(panel.getByRole('button', { name: '展开目录 Fixture Music', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '加载更多目录', exact: true })).toHaveCount(0);
  expect(cursors.filter(cursor => cursor !== null)).toEqual(['roots-next']);
});

test('mock expired directory cursor retries the current directory from its first page', async ({ page }) => {
  const requests: { path: string | null; cursor: string | null }[] = [];
  let firstPages = 0;
  await mockApi(page, async (route, url) => {
    const path = url.searchParams.get('path');
    const cursor = url.searchParams.get('cursor');
    requests.push({ path, cursor });
    if (path === null) return route.fulfill({ json: directoryPage(null, [rootItem]) });
    if (cursor !== null) return route.fulfill({ status: 400, json: { error: { code: 'CURSOR_EXPIRED', message: 'Directory list changed' } } });
    firstPages++;
    await route.fulfill({ json: firstPages === 1
      ? directoryPage(root, [], 'children-next') : directoryPage(root, [childItem]) });
  });
  const panel = await openDirectories(page);
  await panel.getByRole('button', { name: '展开目录 Fixture Music', exact: true }).click();
  await panel.getByRole('button', { name: '加载更多目录', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('目录列表已变化，请重新读取当前目录。');
  await expect(panel.getByRole('button', { name: '加载更多目录', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: '重试', exact: true }).click();
  await expect(panel.getByRole('button', { name: '展开目录 Collection', exact: true })).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(requests.filter(request => request.path !== null)).toEqual([
    { path: root, cursor: null },
    { path: root, cursor: 'children-next' }, { path: root, cursor: null },
  ]);
});

test('mock directory picker fits a narrow screen and closes without selecting a default', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, async route => route.fulfill({ json: directoryPage(null, [rootItem]) }));
  const dialog = await openDirectories(page);
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: '选择目录 Fixture Music', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('限制递归深度', { exact: true })).not.toBeVisible();
  await dialog.getByText('高级选项', { exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: '限制递归深度', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('spinbutton', { name: '递归深度', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: '包含隐藏文件和目录', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '遵循 .nomedia 标记', exact: true })).toBeChecked();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.screenshot({ path: info.outputPath('directory-picker-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '管理目录', exact: true })).toBeFocused();
  await expect(page.getByText('暂无已选择目录', { exact: true })).toBeVisible();
});

test('mock regular user cannot open directory management through settings or its direct URL', async ({ page }) => {
  const requested = await mockApi(page, async route => route.fulfill({ status: 403 }), 'user');
  await page.goto(`${origin}/#/settings?directories=local`);
  await expect(page.getByRole('heading', { name: '本地音乐', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '管理目录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '管理目录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '管理目录', exact: true })).toHaveCount(0);
  expect(requested.some(path => path.includes('/admin/'))).toBe(false);
});

test('mock tree disables unavailable roots and keeps child errors inside their branch', async ({ page }) => {
  await mockApi(page, async (route, url) => {
    if (url.searchParams.get('path') !== null) {
      return route.fulfill({ status: 403, json: { error: { code: 'ACCESS_DENIED', message: 'Directory permission revoked' } } });
    }
    return route.fulfill({ json: directoryPage(null, [rootItem, {
      name: 'Offline Music', path: 'E:\\Offline Music', available: false, configuredRootId: null,
    }]) });
  });
  const dialog = await openDirectories(page);
  await expect(dialog.getByRole('checkbox', { name: '选择目录 Offline Music', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '展开目录 Offline Music', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '展开目录 Fixture Music', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: '选择目录 Fixture Music', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByText('暂无已选择目录', { exact: true })).toBeVisible();
});

test('mock multiple local instances keep their selected directories and management dialogs separate', async ({ page }) => {
  const requested = await mockApi(page, async route => route.fulfill({ json: directoryPage(null, [rootItem]) }));
  const instances = ['local-a', 'local-b'].map(instanceId => ({ instanceId, name: instanceId, runtimeState: 'ready' }));
  await page.route('**/api/v1/admin/plugins', route => route.fulfill({ json: {
    items: [{ pluginId: 'musicfs.localfiles', instances }],
  } }));
  await page.route('**/api/v1/provider-instances', route => route.fulfill({ json: { items: instances.map(instance => ({
    id: instance.instanceId, name: instance.name, availability: 'available',
    plugin: { id: 'musicfs.localfiles', name: 'Local files', localizedNames: { 'zh-CN': '本地音乐' }, features: ['music-source'] },
  })) } }));
  await page.route('**/api/v1/admin/plugin-instances/*/configuration', route => {
    const id = new URL(route.request().url()).pathname.split('/')[5];
    return route.fulfill({ json: {
      revision: 'mock-revision', roots: [{ id, name: id === 'local-a' ? 'Library A' : 'Library B', pathConfigured: true }],
      importOptions: { importDefaults: { recursive: true, maxDepth: 0, skipHidden: true, respectNoMedia: true, excludePatterns: [] } },
    } });
  });
  await page.goto(`${origin}/#/settings`);
  const sources = page.locator('.local-music-source');
  await expect(sources).toHaveCount(2);
  await expect(sources.nth(0)).toContainText('Library A');
  await expect(sources.nth(0)).not.toContainText('Library B');
  await expect(sources.nth(1)).toContainText('Library B');
  await expect(sources.nth(1)).not.toContainText('Library A');
  for (const [index, name] of ['Library A', 'Library B'].entries()) {
    await sources.nth(index).getByRole('button', { name: '管理目录', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '管理目录', exact: true });
    const selected = dialog.getByRole('list', { name: '已选音乐目录', exact: true });
    await expect(selected.getByRole('listitem')).toHaveCount(1);
    await expect(selected).toContainText(name);
    await expect(dialog.getByRole('treeitem')).toHaveCount(1);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
  expect(requested).toContain('/api/v1/admin/plugin-instances/local-a/directories');
  expect(requested).toContain('/api/v1/admin/plugin-instances/local-b/directories');
});
