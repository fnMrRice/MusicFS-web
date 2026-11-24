import { musicPage } from "../fixtures/music-catalog";
import { test, expect, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import type { ScanJob, ScanRequest } from '../../src/api/scans';
import { routeApi } from '../fixtures/control-mock';
import { instanceIds, localPlugin } from '../fixtures/plugins';
import { track } from '../fixtures/dto';

let server: PreviewServer;
const origin = 'http://127.0.0.1:18149';
const scanPath = `/api/v1/provider-instances/${instanceIds.local}/scan-jobs`;
const options = { recursive: true, maxDepth: 0, importLyrics: false, excludePatterns: [], skipHidden: true, respectNoMedia: true };
const job = (status: ScanJob['status'], observed: number, id = 'external-job'): ScanJob => ({
  jobId: id, providerInstanceId: instanceIds.local, status, progress: { observed }, complete: status === 'succeeded', error: null,
});
type Remote = { job: ScanJob | null; roots: { rootId: string; trackCount: number; sizeBytes: number }[];
  failStatistics?: boolean; holdStatistics?: Promise<void>; published?: boolean };
test.beforeAll(async () => { server = await preview({ preview: { host: '127.0.0.1', port: 18149, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((done) => server?.httpServer.close(() => done())); });

async function mock(page: Page, remote: Remote) {
  const requests = { posts: 0, statuses: 0, statistics: 0, submissions: [] as ScanRequest[] };
  const control = await routeApi(page, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === scanPath && route.request().method() === 'POST') {
      requests.posts++;
      requests.submissions.push(route.request().postDataJSON());
      remote.job = job('running', 0, `new-job-${requests.posts}`);
      return route.fulfill({ status: 202, json: { jobId: remote.job.jobId, merged: false } });
    }
    if (path.endsWith('/scan-status')) {
      requests.statuses++;
      return route.fulfill({ json: { job: remote.job } });
    }
    if (path.includes('/scan-jobs/')) return route.fulfill({ json: remote.job });
    if (path.endsWith('/root-statistics')) {
      requests.statistics++;
      await remote.holdStatistics;
      return remote.failStatistics ? route.fulfill({ status: 503, json: { error: { code: 'TEMPORARY_FAILURE' } } })
        : route.fulfill({ json: { roots: remote.roots } });
    }
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', apiVersion: '1', ready: true, instanceId: 'fixture' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'fixture', user: { id: 'admin', role: 'admin' } };
    if (path.endsWith('/provider-instances')) json = { items: [{ id: instanceIds.local, name: '本地音乐', plugin: localPlugin,
      availability: 'available', capabilities: ['library.scan'], scanState: 'idle', roots: [{ id: 'music', name: 'Music' }, { id: 'empty', name: 'Empty' }],
      configuration: { schemaRevision: 'local-import-v5', importDefaults: options } }] };
    if (path.endsWith('/admin/plugins')) json = { items: [{ pluginId: localPlugin.id, plugin: localPlugin, version: '0.3.0',
      supportsMultipleInstances: false, instances: [{ instanceId: instanceIds.local, name: '本地音乐', runtimeState: 'ready' }] }] };
    if (path.endsWith('/configuration')) json = { revision: 'fixture-revision', roots: [
      { id: 'music', name: 'Music', pathConfigured: true }, { id: 'empty', name: 'Empty', pathConfigured: true }],
      importOptions: { schemaRevision: 'local-import-v5', importDefaults: options } };
    if (path.endsWith('/library/tracks')) json = musicPage(remote.published ? [track] : [], remote.published ? '2' : '1');
    await route.fulfill({ json });
  });
  return { requests, changed: () => control.event("activity.changed", { resources: ["scans"] }) };
}

test('independent windows discover progress, reload and continue tracking without extra submissions', async ({ page, browser }) => {
  const remote: Remote = { job: null, roots: [{ rootId: 'music', trackCount: 2, sizeBytes: 1024 ** 3 }] };
  const observer = await mock(page, remote);
  const progress = page.locator('.local-scan-status').getByRole('status');
  const other = await browser.newContext({ locale: 'zh-CN' });
  try {
    const second = await other.newPage();
    const initiator = await mock(second, remote);
    await page.goto(`${origin}/#/library`);
    await expect(page.getByText('音乐库还很安静', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('button', { name: '刷新全部目录', exact: true })).toBeEnabled();
    await expect(page.locator('.directory-saved-stats').first()).toHaveText('2 首 · 1.0 GiB');
    await second.goto(`${origin}/#/settings`);
    await second.getByRole('button', { name: '刷新目录 Music 的元数据', exact: true }).click();
    await expect.poll(() => initiator.requests.posts).toBe(1);
    observer.changed();
    await expect(progress).toContainText('已发现 0 首');
    expect(initiator.requests.submissions).toEqual([{ mode: 'full', schemaRevision: 'local-import-v5', rootIds: ['music'], options: { refreshMetadata: true } }]);
    expect(observer.requests.posts).toBe(0);
    remote.job = job('running', 200, remote.job!.jobId);
    observer.changed();
    await expect(progress).toContainText('已发现 200 首');
    await page.reload();
    await expect(progress).toContainText('已发现 200 首');
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes(':scan:')))).toEqual([]);
    await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '外观与语言', exact: true }).click();
    remote.job = job('running', 400, remote.job!.jobId);
    observer.changed();
    await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '音乐源', exact: true }).click();
    await expect(progress).toContainText('已发现 400 首');
    await expect(page.locator('.directory-saved-stats').first()).toHaveText('2 首 · 1.0 GiB');
    remote.roots = [{ rootId: 'music', trackCount: 400, sizeBytes: 12 * 1024 ** 3 }];
    remote.published = true;
    remote.job = job('succeeded', 400, remote.job!.jobId);
    observer.changed();
    await expect(progress).toContainText('扫描完成，共发现 400 首');
    await expect(page.locator('.directory-saved-stats').first()).toHaveText('400 首 · 12.0 GiB');
    await expect(page.locator('.directory-saved-stats').nth(1)).toHaveText('0 首 · 0 B');
    await page.getByRole('button', { name: '展开作品库', exact: true }).click();
    await page.getByRole('link', { name: '曲目列表', exact: true }).click();
    await expect(page.getByText(track.displayName, { exact: true }).first()).toBeVisible();
    await page.goto(`${origin}/#/settings`);
    await page.reload();
    await expect(progress).toContainText('扫描完成，共发现 400 首');
    await page.bringToFront();
    const beforeFocus = observer.requests.statuses;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => observer.requests.statuses).toBeGreaterThan(beforeFocus);
    expect(observer.requests.posts).toBe(0);
    expect(initiator.requests.posts).toBe(1);
  } finally { await other.close(); }
});

test('statistics distinguish loading and errors from zero, retry and fit narrow layouts', async ({ page }, info) => {
  let release!: () => void;
  const remote: Remote = { job: null, roots: [{ rootId: 'music', trackCount: 946, sizeBytes: Math.round(12.3 * 1024 ** 3) }],
    holdStatistics: new Promise<void>((done) => { release = done; }), failStatistics: true };
  const { requests } = await mock(page, remote);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/#/settings`);
  await expect(page.locator('.directory-saved-stats').first()).toHaveText('正在读取统计…');
  await expect(page.locator('.directory-saved-stats').first()).not.toContainText('0 首');
  release();
  await expect(page.locator('.directory-saved-stats').first()).toHaveText('统计暂不可用');
  remote.failStatistics = false;
  await page.locator('.directory-statistics-error').getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.directory-saved-stats').first()).toHaveText('946 首 · 12.3 GiB');
  await expect(page.locator('.directory-saved-stats').nth(1)).toHaveText('0 首 · 0 B');
  const panel = page.locator('.local-music-source');
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '编辑目录 Music', exact: true })).toBeVisible();
  await panel.screenshot({ path: info.outputPath('directory-statistics-mobile.png') });
  expect(requests.posts).toBe(0);
});
