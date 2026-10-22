import { instanceIds, localPlugin } from "../fixtures/plugins";
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

async function mockApi(page: Page, directories: (route: Route, url: URL) => Promise<void>, role = 'admin', configure?: (route: Route) => Promise<void>) {
  const requested: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    requested.push(path);
    if (path.endsWith('/directories')) return directories(route, url);
    if (path.endsWith('/configuration') && configure) return configure(route);
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', apiVersion: '1', ready: true, instanceId: 'mock-directories' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'test', user: { id: role, role } };
    if (path.endsWith('/provider-instances')) json = { items: [{
      id: instanceIds.local, name: 'Fixture', availability: 'unavailable',
      plugin: { id: 'musicfs.plugin.source.localfiles', name: 'Local files', localizedNames: { 'zh-CN': '本地音乐' }, features: ['music-source'] },
    }] };
    if (path.endsWith('/admin/plugins')) json = { items: [{
      pluginId: localPlugin.id, plugin: localPlugin, supportsMultipleInstances: false, instances: [{ instanceId: instanceIds.local, name: 'Fixture', runtimeState: 'pending_configuration' }],
    }] };
    if (path.endsWith('/configuration')) json = {
      revision: 'mock-revision', roots: [], rootImportDefaultsSupported: true,
      importOptions: { importDefaults: { recursive: true, maxDepth: 0, skipHidden: true, respectNoMedia: true, excludePatterns: [] } },
    };
    await route.fulfill({ json });
  });
  return requested;
}

async function openDirectories(page: Page) {
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '添加本地目录', exact: true }).click();
  return page.getByRole('dialog', { name: '添加本地目录', exact: true });
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
  await expect(dialog.getByRole('button', { name: '添加所选目录', exact: true })).toBeDisabled();
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
  await expect(page.getByRole('button', { name: '添加本地目录', exact: true })).toBeFocused();
  await expect(page.getByText('暂无已添加目录', { exact: true })).toBeVisible();
});

test('mock regular user cannot open directory management through settings or its direct URL', async ({ page }) => {
  const requested = await mockApi(page, async route => route.fulfill({ status: 403 }), 'user');
  await page.goto(`${origin}/#/settings?directories=${instanceIds.local}`);
  await expect(page.getByRole('heading', { name: '本地音乐', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加本地目录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '添加本地目录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '添加本地目录', exact: true })).toHaveCount(0);
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
  await expect(page.getByText('暂无已添加目录', { exact: true })).toBeVisible();
});

test('mock conflicting additions preserve saved directories and require an explicit reload', async ({ page }) => {
  let saves = 0;
  const options = { recursive: true, maxDepth: 0, skipHidden: true, respectNoMedia: true, excludePatterns: [] };
  await mockApi(page, async (route, url) => route.fulfill({ json: url.searchParams.has('path')
    ? directoryPage(root, [{ ...childItem, configuredRootId: 'saved' }]) : directoryPage(null, [rootItem]) }), 'admin', async route => {
    if (route.request().method() === 'PUT') {
      saves++;
      const roots = route.request().postDataJSON().musicRoots;
      expect(roots).toHaveLength(2);
      expect(roots[0]).toEqual({ id: 'saved', name: 'Collection' });
      return route.fulfill({ status: 412, json: { error: { code: 'REVISION_CONFLICT', message: 'Changed by another administrator' } } });
    }
    return route.fulfill({ json: { revision: saves ? 'new-revision' : 'mock-revision', rootImportDefaultsSupported: true,
      roots: [{ id: 'saved', name: 'Collection', pathConfigured: true, importDefaults: options }],
      importOptions: { importDefaults: options, schemaRevision: 'local-import-v5' } } });
  });
  const dialog = await openDirectories(page);
  await dialog.getByRole('button', { name: '展开目录 Fixture Music', exact: true }).click();
  const saved = dialog.getByRole('checkbox', { name: '选择目录 Collection', exact: true });
  await expect(saved).toBeChecked();
  await expect(saved).toBeDisabled();
  await dialog.getByRole('checkbox', { name: '选择目录 Fixture Music', exact: true }).check();
  await dialog.getByRole('button', { name: '添加所选目录', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('内容已发生变化，请刷新后重新编辑。');
  await expect(dialog.getByRole('button', { name: '添加所选目录', exact: true })).toBeDisabled();
  await expect(saved).toBeChecked();
  await dialog.getByRole('button', { name: '重新读取配置并放弃未保存选择', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('list', { name: '待添加的目录', exact: true }).getByRole('listitem')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '添加所选目录', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('list', { name: '已添加的目录', exact: true }).getByRole('listitem')).toHaveCount(1);
  expect(saves).toBe(1);
});

test('mock rejected deletion preserves the target and saved list until a confirmed save', async ({ page }) => {
  let saves = 0;
  await mockApi(page, async route => route.fulfill({ json: directoryPage(null, [rootItem]) }), 'admin', async route => {
    if (route.request().method() === 'PUT') {
      saves++;
      expect(route.request().postDataJSON().musicRoots).toEqual([]);
      return route.fulfill({ status: 412, json: { error: { code: 'REVISION_CONFLICT', message: 'Changed by another administrator' } } });
    }
    return route.fulfill({ json: { revision: saves ? 'new-revision' : 'mock-revision', rootImportDefaultsSupported: true,
      roots: [{ id: 'saved', name: 'Collection', pathConfigured: true }] } });
  });
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '删除目录 Collection', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除本地目录', exact: true });
  await expect(dialog.getByText('删除已添加的目录“Collection”？', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('内容已发生变化，请刷新后重新编辑。');
  await expect(dialog.getByText('此目录已被删除，请关闭后重新选择。', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('删除已添加的目录“Collection”？', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '重新读取配置并放弃未保存选择', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '删除', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('list', { name: '已添加的目录', exact: true }).getByRole('listitem')).toHaveCount(1);
  expect(saves).toBe(1);
});

test('mock uncertain deletion retries the identical request and only removes the list entry after confirmation', async ({ page }) => {
  const requests: { body: unknown; key: string | undefined; revision: string | undefined }[] = [];
  let applied = false;
  await mockApi(page, async route => route.fulfill({ json: directoryPage(null, [rootItem]) }), 'admin', async route => {
    if (route.request().method() === 'PUT') {
      const headers = route.request().headers();
      requests.push({ body: route.request().postDataJSON(), key: headers['idempotency-key'], revision: headers['if-match'] });
      if (requests.length === 1) return route.abort('failed');
      applied = true;
      return route.fulfill({ status: 202, json: { operationId: 'delete-op', status: 'succeeded', errorCode: null } });
    }
    return route.fulfill({ json: { revision: applied ? 'new-revision' : 'mock-revision', rootImportDefaultsSupported: true,
      roots: applied ? [] : [{ id: 'saved', name: 'Collection', pathConfigured: true }] } });
  });
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '删除目录 Collection', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除本地目录', exact: true });
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('无法连接 Server，请检查连接。');
  await expect(dialog.getByText('删除已添加的目录“Collection”？', { exact: true })).toBeVisible();
  await expect(dialog.getByText('此目录已被删除，请关闭后重新选择。', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '继续确认保存结果', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('暂无已添加目录', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0].key).toBeTruthy();
  expect(requests[1]).toEqual(requests[0]);
});

for (const initial of [true, false, undefined]) {
  test(`artwork import follows effective settings and stays disabled when saving other options (${initial})`, async ({ page }) => {
    let saved: { importDefaults: { importArtwork: boolean }; musicRoots: { importDefaults: { importArtwork: boolean } }[] } | null = null;
    const options = { recursive: true, maxDepth: 0, importLyrics: false, skipHidden: true, respectNoMedia: true, excludePatterns: [],
      ...(initial === undefined ? {} : { importArtwork: initial }) };
    await mockApi(page, async route => route.fulfill({ json: directoryPage(null, [rootItem]) }), 'admin', async route => {
      if (route.request().method() === 'PUT') {
        saved = route.request().postDataJSON();
        return route.fulfill({ status: 412, json: { error: { code: 'REVISION_CONFLICT' } } });
      }
      return route.fulfill({ json: { revision: 'artwork-revision', roots: [], rootImportDefaultsSupported: true,
        importOptions: { importDefaults: options, schemaRevision: 'local-import-v6' } } });
    });
    const dialog = await openDirectories(page);
    await dialog.getByText('高级选项', { exact: true }).click();
    const artwork = dialog.getByRole('checkbox', { name: '导入曲目封面', exact: true });
    if (initial) await expect(artwork).toBeChecked(); else await expect(artwork).not.toBeChecked();
    await artwork.uncheck();
    await dialog.getByRole('checkbox', { name: '递归查找子目录', exact: true }).uncheck();
    await dialog.getByRole('checkbox', { name: '选择目录 Fixture Music', exact: true }).check();
    await dialog.getByRole('button', { name: '添加所选目录', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(saved).not.toBeNull();
    expect(saved!.importDefaults.importArtwork).toBe(initial === true);
    expect(saved!.musicRoots[0].importDefaults.importArtwork).toBe(false);
  });
}
