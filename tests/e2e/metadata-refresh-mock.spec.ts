import { test, expect, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { instanceIds, localPlugin } from '../fixtures/plugins';
import { routeApi } from '../fixtures/control-mock';

let server: PreviewServer;
const origin = 'http://127.0.0.1:18155';
const scanPath = `/api/v1/provider-instances/${instanceIds.local}/scan-jobs`;
const options = { recursive: true, maxDepth: 0, importLyrics: false, importArtwork: false, excludePatterns: [], skipHidden: true, respectNoMedia: true };
const roots = [{ id: 'music', name: 'Music', pathConfigured: true }, { id: 'other', name: 'Other', pathConfigured: true }];
test.beforeAll(async () => { server = await preview({ preview: { host: '127.0.0.1', port: 18155, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

async function mockApi(page: Page) {
  const state = { posts: 0, metadataReads: 0, configWrites: 0, done: false, failed: false, unavailable: false, missing: false };
  await routeApi(page, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === scanPath) {
      ++state.posts;
      expect(route.request().postDataJSON()).toEqual({ mode: 'full', schemaRevision: 'local-import-v5', rootIds: ['music'], options: { refreshMetadata: true } });
      return route.fulfill({ status: 202, json: { jobId: 'refresh-job', merged: false } });
    }
    if (path === '/api/v1/scan-jobs/refresh-job') return route.fulfill({ json: {
      jobId: 'refresh-job', providerInstanceId: instanceIds.local, status: 'succeeded', complete: true, progress: { observed: 2 }, error: null,
    } });
    if (path.endsWith('/metadata-results')) {
      ++state.metadataReads;
      if (state.missing) return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Result unavailable' } } });
      const second = url.searchParams.has('cursor');
      return route.fulfill({ json: { items: [{ triggerId: second ? 'two' : 'one', scanJobId: 'refresh-job', reason: 'refreshMetadata',
        state: second && !state.done ? 'running' : state.failed ? 'failed' : 'completed', failureCode: state.failed ? 'SOURCE_OFFLINE' : null,
        actions: second && !state.done ? [] : [{ field: 'artwork', status: state.failed ? 'pending' : second ? 'skipped' : 'applied', reason: second ? 'manualLocked' : 'selected' }],
      }], nextCursor: second ? null : 'page-two' } });
    }
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', apiVersion: '1', ready: true, instanceId: 'fixture' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'fixture', user: { id: 'admin', role: 'admin' } };
    if (path.endsWith('/provider-instances')) json = { items: [{ id: instanceIds.local, name: '本地音乐', plugin: localPlugin,
      availability: state.unavailable ? 'offline' : 'available', capabilities: ['library.scan'], scanState: 'idle', roots,
      configuration: { schemaRevision: 'local-import-v5', importDefaults: options } }] };
    if (path.endsWith('/admin/plugins')) json = { items: [{ pluginId: localPlugin.id, plugin: localPlugin, version: '0.3.0',
      supportsMultipleInstances: false, instances: [{ instanceId: instanceIds.local, name: '本地音乐', runtimeState: state.unavailable ? 'disabled' : 'ready' }] }] };
    if (path.endsWith('/configuration')) {
      if (route.request().method() !== 'GET') ++state.configWrites;
      json = { revision: 'fixture-revision', roots, rootImportDefaultsSupported: true,
        importOptions: { schemaRevision: 'local-import-v5', importDefaults: options } };
    }
    await route.fulfill({ json });
  });
  return state;
}

test('refresh beside edit targets one folder and waits for metadata across reload', async ({ page }, info) => {
  const state = await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/#/settings`);
  const edit = page.getByRole('button', { name: '编辑目录 Music', exact: true });
  const refresh = page.getByRole('button', { name: '刷新目录 Music 的元数据', exact: true });
  await expect(refresh).toHaveText('刷新');
  expect(await edit.evaluate(element => element.nextElementSibling?.textContent)).toBe('刷新');
  const panel = page.locator('.local-music-source');
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await panel.screenshot({ path: info.outputPath('metadata-refresh-mobile.png') });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(page.getByRole('button', { name: '刷新目录 Other 的元数据', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: '正在刷新封面和歌词' })).toContainText('1/2');
  await expect(page.getByText(/元数据刷新完成/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: '正在刷新封面和歌词' })).toBeVisible();
  expect(state.posts).toBe(1);
  state.done = true;
  await expect(page.getByRole('status').filter({ hasText: '元数据刷新完成' })).toContainText('2');
  await expect(refresh).toBeEnabled();
  expect(state.configWrites).toBe(0);
  expect(state.posts).toBe(1);
});

test('metadata failures are visible and do not claim success', async ({ page }) => {
  const state = await mockApi(page);
  state.done = true;
  state.failed = true;
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '刷新目录 Music 的元数据', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('元数据刷新失败');
  await expect(page.getByText(/元数据刷新完成/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新目录 Music 的元数据', exact: true })).toBeEnabled();
});

test('refresh is disabled while the local source is unavailable', async ({ page }) => {
  const state = await mockApi(page);
  state.unavailable = true;
  await page.goto(`${origin}/#/settings`);
  await expect(page.getByRole('button', { name: '刷新目录 Music 的元数据', exact: true })).toBeDisabled();
  expect(state.posts).toBe(0);
});

test('missing metadata results never show refresh complete', async ({ page }) => {
  const state = await mockApi(page);
  state.missing = true;
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '刷新目录 Music 的元数据', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText(/元数据刷新完成/)).toHaveCount(0);
});
