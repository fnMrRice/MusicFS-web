import { test, expect, type Page, type Route } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { instanceIds, localPlugin } from '../fixtures/plugins';
import { track } from '../fixtures/dto';

let server: PreviewServer;
const origin = 'http://127.0.0.1:18147';
const scanPath = `/api/v1/provider-instances/${instanceIds.local}/scan-jobs`;
const options = { recursive: true, maxDepth: 0, importLyrics: false, excludePatterns: [], skipHidden: true, respectNoMedia: true };
test.beforeAll(async () => { server = await preview({ preview: { host: '127.0.0.1', port: 18147, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

async function mockApi(page: Page, scan: (route: Route, path: string) => Promise<void>, state = 'ready', published = () => false,
  latest: () => unknown = () => null) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === scanPath || path.includes('/scan-jobs/')) return scan(route, path);
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith('/scan-status')) json = { job: latest() };
    if (path.endsWith('/root-statistics')) json = { roots: [] };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', apiVersion: '1', ready: true, instanceId: 'manual-scan-fixture' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'fixture', user: { id: 'admin', role: 'admin' } };
    if (path.endsWith('/provider-instances')) json = { items: [{ id: instanceIds.local, name: '本地音乐', plugin: localPlugin,
      availability: state === 'ready' ? 'available' : 'offline', capabilities: state === 'ready' ? ['library.scan'] : [],
      scanState: 'idle', roots: state === 'ready' ? [{ id: 'music', name: 'Music' }] : [],
      configuration: { schemaRevision: 'local-import-v5', importDefaults: options } }] };
    if (path.endsWith('/admin/plugins')) json = { items: [{ pluginId: localPlugin.id, plugin: localPlugin, version: '0.3.0',
      supportsMultipleInstances: false, instances: [{ instanceId: instanceIds.local, name: '本地音乐', runtimeState: state }] }] };
    if (path.endsWith('/configuration')) json = { revision: 'fixture-revision', roots: [{ id: 'music', name: 'Music', pathConfigured: true }],
      rootImportDefaultsSupported: true, importOptions: { schemaRevision: 'local-import-v5', importDefaults: options } };
    if (path.endsWith('/source-tracks')) json = { items: published() ? [track] : [], nextCursor: null, libraryRevision: published() ? '2' : '1' };
    await route.fulfill({ json });
  });
}

const job = (status: string, observed = 0, complete = false) => ({
  jobId: 'fixture-job', providerInstanceId: instanceIds.local, status, progress: { observed }, complete, error: null,
});

test('manual scan keeps one job across reload and shows progress without a fake percentage', async ({ page }, info) => {
  let posts = 0;
  let reads = 0;
  let done = false;
  await mockApi(page, async (route, path) => {
    if (path === scanPath) {
      posts++;
      expect(route.request().postDataJSON()).toEqual({ mode: 'full', schemaRevision: 'local-import-v5', rootIds: ['music'], options: {} });
      return route.fulfill({ status: 202, json: { jobId: 'fixture-job', merged: false } });
    }
    reads++;
    await route.fulfill({ json: done ? job('succeeded', 12, true) : job('running', 7) });
  }, 'ready', () => false, () => posts ? done ? job('succeeded', 12, true) : job('running', 7) : null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '扫描音乐', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在扫描…', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: /7/ })).toBeVisible();
  const panel = page.locator('.local-music-source');
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await panel.screenshot({ path: info.outputPath('manual-scan-mobile.png') });
  const previousReads = reads;
  await page.reload();
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  await expect(page.getByRole('button', { name: '正在扫描…', exact: true })).toBeDisabled();
  expect(posts).toBe(1);
  done = true;
  await expect(page.getByRole('status').filter({ hasText: '扫描完成' })).toContainText('12');
  await expect(page.getByRole('button', { name: '扫描音乐', exact: true })).toBeEnabled();
  expect(posts).toBe(1);
});

test('uncertain scan submission reuses the request and paused jobs never report success', async ({ page }) => {
  const submitted: { body: unknown; key: string | undefined }[] = [];
  await mockApi(page, async (route, path) => {
    if (path === scanPath) {
      submitted.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
      if (submitted.length === 1) return route.abort('failed');
      return route.fulfill({ status: 202, json: { jobId: 'fixture-job', merged: true } });
    }
    await route.fulfill({ json: { ...job('paused', 2), error: { code: 'SOURCE_OFFLINE', message: 'Source is offline' } } });
  });
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '扫描音乐', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '继续确认扫描结果', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('暂停');
  await expect(page.getByText(/扫描完成/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '扫描音乐', exact: true })).toBeEnabled();
  expect(submitted).toHaveLength(2);
  expect(submitted[0].key).toBeTruthy();
  expect(submitted[1]).toEqual(submitted[0]);
});

test('disabled local music cannot submit a scan', async ({ page }) => {
  let requests = 0;
  await mockApi(page, async route => { requests++; await route.fulfill({ status: 503 }); }, 'disabled');
  await page.goto(`${origin}/#/settings`);
  await expect(page.getByRole('button', { name: '扫描音乐', exact: true })).toBeDisabled();
  await expect(page.locator('.local-music-source')).toContainText(/启用|不可用/);
  expect(requests).toBe(0);
});

test('leaving settings while scanning still refreshes an open cached library', async ({ page }) => {
  let done = false;
  let posts = 0;
  await mockApi(page, async (route, path) => {
    if (path === scanPath) {
      posts++;
      return route.fulfill({ status: 202, json: { jobId: 'fixture-job', merged: false } });
    }
    await route.fulfill({ json: done ? job('succeeded', 1, true) : job('running') });
  }, 'ready', () => done);
  await page.goto(`${origin}/#/library`);
  await expect(page.getByText('音乐库还很安静', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '扫描音乐', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在扫描…', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '展开作品库', exact: true }).click();
  await page.getByRole('link', { name: '曲目列表', exact: true }).click();
  await expect(page.getByText('音乐库还很安静', { exact: true })).toBeVisible();
  done = true;
  await expect(page.getByText(track.displayName, { exact: true }).first()).toBeVisible();
  expect(posts).toBe(1);
});

test('a saved folder automatically scans after applying even after back navigation and reload', async ({ page }) => {
  let configured = false;
  let published = false;
  let posts = 0;
  await mockApi(page, async (route, path) => {
    if (path === scanPath) {
      expect(configured).toBe(true);
      posts++;
      return route.fulfill({ status: 202, json: { jobId: 'fixture-job', merged: false } });
    }
    published = true;
    await route.fulfill({ json: job('succeeded', 1, true) });
  }, 'ready', () => published);
  await page.route('**/api/v1/admin/plugin-instances/*/configuration', async route => {
    if (route.request().method() === 'PUT') return route.fulfill({ status: 202,
      json: { operationId: 'fixture-config', status: 'applying', errorCode: null } });
    return route.fulfill({ json: { revision: 'fixture-revision', rootImportDefaultsSupported: true,
      roots: [{ id: 'music', name: 'Music', pathConfigured: true, importDefaults: options }],
      importOptions: { schemaRevision: 'local-import-v5', importDefaults: options } } });
  });
  await page.route('**/api/v1/admin/plugin-operations/fixture-config', route => route.fulfill({
    json: { operationId: 'fixture-config', status: configured ? 'succeeded' : 'applying', errorCode: null },
  }));
  await page.goto(`${origin}/#/library`);
  await expect(page.getByText('音乐库还很安静', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '编辑目录 Music', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑目录配置', exact: true });
  await dialog.getByLabel('目录名称', { exact: true }).fill('Edited Music');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('正在应用目录设置');
  expect(posts).toBe(0);
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('音乐库还很安静', { exact: true })).toBeVisible();
  configured = true;
  await expect(page.getByText(track.displayName, { exact: true }).first()).toBeVisible();
  expect(posts).toBe(1);
});
