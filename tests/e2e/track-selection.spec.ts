import { expect, test, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import type { Binding, Playlist } from '../../src/api/content';
import { routeApi } from '../fixtures/control-mock';
import { deferred, track } from '../fixtures/dto';
import { musicTrack } from '../fixtures/music-catalog';

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Preview address unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const pageSize = 40;
const tracks = Array.from({ length: pageSize * 3 }, (_, index) => ({ ...track,
  sourceTrackId: `source-${index}`, assetId: `asset-${index}`, providerInstanceId: 'local',
  displayName: `Track ${index}.wav`,
}));
// 曲目身份与来源身份不同，最后一项没有可播放来源。
const catalog = tracks.map((source, index) => ({ ...musicTrack(source), trackId: `track-${index}`,
  selectedSource: index === tracks.length - 1 ? null : musicTrack(source).selectedSource }));
const titles = tracks.slice(0, -1).map((item) => item.displayName);
const all = (page: Page) => page.getByRole('checkbox', { name: '全选曲目', exact: true });
const choice = (page: Page, index: number) => page.getByRole('checkbox', { name: `选择 Track ${index}.wav`, exact: true });
const rows = (page: Page) => page.locator('table.tracks tbody > tr');
const action = (page: Page, name: string) => page.locator('.list-actions').getByRole('button', { name, exact: true });

async function setup(page: Page, failPageOnce = false, favoriteResponse?: Promise<void>) {
  const requests: string[] = [], errors: string[] = [], favoriteWrites: string[] = [];
  const invalidSourceScopes: string[] = [], playlistWrites: { name: string; bindings: Binding[] }[] = [];
  const matchingWrites: { sourceTrackIds: string[] }[] = [];
  const playlists: Playlist[] = [], favorites = new Set<string>();
  let failed = false;
  page.on('pageerror', (error) => errors.push(error.message));
  await routeApi(page, async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (path.endsWith('/library/tracks')) {
      const cursor = url.searchParams.get('after');
      requests.push(`${url.searchParams.get('providerInstanceId') ?? 'all'}:${cursor ?? 'first'}`);
      if (cursor && failPageOnce && !failed) {
        failed = true;
        return route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: 'Offline' } } });
      }
      if (url.searchParams.get('providerInstanceId') === 'other') {
        return route.fulfill({ json: { items: [catalog[0]], nextAfter: null, libraryRevision: '1', matchingRevision: 1 } });
      }
      const offset = cursor ? Number(cursor.slice(1)) : 0;
      return route.fulfill({ json: { items: catalog.slice(offset, offset + pageSize),
        nextAfter: offset + pageSize < tracks.length ? `c${offset + pageSize}` : null, libraryRevision: '1', matchingRevision: 1 } });
    }
    if (path.endsWith('/selection') || path.endsWith('/favorites/batch')) {
      invalidSourceScopes.push(path);
      return route.fulfill({ status: 400, json: { error: { code: 'INVALID_REQUEST', message: 'Catalog IDs are not source IDs' } } });
    }
    const favorite = /\/me\/favorites\/(track-\d+)$/.exec(path);
    if (favorite && (method === 'PUT' || method === 'DELETE')) {
      favoriteWrites.push(favorite[1]);
      const item = catalog.find((item) => item.trackId === favorite[1])!;
      if (method === 'DELETE') { favorites.delete(item.trackId); return route.fulfill({ status: 204 }); }
      favorites.add(item.trackId);
      await favoriteResponse;
      return route.fulfill({ json: { musicTrack: item, track: item.selectedSource, forcedSourceTrackId: null, recordedAt: '2026-11-20T00:00:00Z' } });
    }
    if (path.endsWith('/me/favorites')) return route.fulfill({ json: { items: [], nextCursor: null, revision: '1/1' } });
    if (path.endsWith('/playlists') && method === 'POST') {
      const input = request.postDataJSON() as { name: string; bindings: Binding[] };
      playlistWrites.push(input);
      const result = { playlistId: `playlist-${playlists.length + 1}`, name: input.name, ruleRevision: 1,
        hideRevision: 0, snapshotRevision: 0, stale: true, bindings: input.bindings };
      playlists.push(result);
      return route.fulfill({ json: result });
    }
    if (path.endsWith('/playlists')) return route.fulfill({ json: { items: playlists, nextAfter: null } });
    if (path.endsWith('/matching/links')) {
      matchingWrites.push(request.postDataJSON());
      return route.fulfill({ json: { revision: 2, operationId: 'merge-1', recordingId: 'recording-1' } });
    }
    if (method === 'DELETE') return route.fulfill({ status: 204 });
    let json: unknown = { items: [], nextCursor: null, nextAfter: null };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', ready: true, apiVersion: '1', instanceId: 'track-selection' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'fixture', user: { id: 'listener', role: 'user' } };
    if (path.endsWith('/matching/revision')) json = { revision: 1 };
    if (path.endsWith('/provider-instances')) json = { items: [
      { id: 'local', name: 'Local', availability: 'available', capabilities: [], roots: [] },
      { id: 'other', name: 'Other', availability: 'available', capabilities: [], roots: [] },
    ] };
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/library`);
  await expect(rows(page)).toHaveCount(pageSize);
  await expect(choice(page, 0)).toBeVisible();
  return { requests, errors, favoriteWrites, favorites, invalidSourceScopes, playlistWrites, matchingWrites };
}
async function expectQueue(page: Page, expected: string[]) {
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await expect(page.locator('.queue-list button')).toHaveText(expected);
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
}

test('catalog select all persists across pages and excludes stable track IDs before queueing real sources', async ({ page }) => {
  const state = await setup(page);
  await all(page).check(); await choice(page, 1).uncheck();
  await expect(all(page)).toBeChecked({ indeterminate: true });
  await page.locator('#page-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(rows(page)).toHaveCount(pageSize * 2);
  await expect(choice(page, 40)).toBeChecked(); await expect(choice(page, 1)).not.toBeChecked();
  await action(page, '加入队列').click();
  await expectQueue(page, titles.filter((_, index) => index !== 1));
  expect(state.requests).toEqual(['all:first', 'all:c40', 'all:c80']);
  expect(state.invalidSourceScopes).toEqual([]); expect(state.errors).toEqual([]);
});

test('selected row context action reads the complete catalog before queueing', async ({ page }) => {
  const state = await setup(page);
  await all(page).check(); await rows(page).first().click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: '添加到播放列表', exact: true }).click();
  await expectQueue(page, titles);
  expect(state.requests).toEqual(['all:first', 'all:c40', 'all:c80']);
  expect(state.invalidSourceScopes).toEqual([]); expect(state.errors).toEqual([]);
});

test('playlist creation preserves catalog IDs and tracks without any source', async ({ page }) => {
  const state = await setup(page);
  await all(page).check(); await choice(page, 2).uncheck();
  await action(page, '添加到歌单').click();
  const dialog = page.getByRole('dialog', { name: '添加到歌单', exact: true });
  await dialog.getByLabel('歌单名称', { exact: true }).fill('All selected tracks');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const refs = state.playlistWrites[0].bindings[0].entries!.map((entry) => entry.source);
  expect(refs.map((ref) => ref.trackId)).toEqual(catalog.filter((_, index) => index !== 2).map((item) => item.trackId));
  expect(refs.every((ref) => ref.sourceTrackId === null && ref.forcedSourceTrackId === null)).toBe(true);
  expect(state.invalidSourceScopes).toEqual([]); expect(state.errors).toEqual([]);
});

test('failed catalog pagination performs no partial favorite write and retry retains exclusions', async ({ page }) => {
  const state = await setup(page, true);
  await all(page).check(); await choice(page, 3).uncheck();
  await action(page, '收藏').click();
  await expect(page.getByRole('alert').first()).toBeVisible(); await expect(action(page, '收藏')).toBeEnabled();
  expect(state.favoriteWrites).toEqual([]);
  await action(page, '收藏').click();
  await expect.poll(() => state.favorites.size).toBe(catalog.length - 1);
  expect(state.favorites.has('track-119')).toBe(true);
  expect(state.favorites.has('track-3')).toBe(false);
  expect(state.invalidSourceScopes).toEqual([]); expect(state.errors).toEqual([]);
});

test('clearing selection during confirmed favorite writes preserves their eventual result', async ({ page }) => {
  const response = deferred<void>();
  const state = await setup(page, false, response.promise);
  await all(page).check(); await choice(page, 5).uncheck();
  await action(page, '收藏').click();
  await expect.poll(() => state.favorites.size).toBe(catalog.length - 1);
  await action(page, '清空选择').click();
  response.resolve();
  await expect(page.getByRole('button', { name: '取消收藏 Track 0.wav', exact: true })).toBeVisible();
  await expect(all(page)).not.toBeChecked();
  await expect(page.locator('table.tracks tbody input:checked')).toHaveCount(0);
  expect(state.invalidSourceScopes).toEqual([]); expect(state.errors).toEqual([]);
});

for (const reset of ['clear', 'source', 'refresh'] as const) {
  test(`${reset} resets catalog selection before any write`, async ({ page }) => {
    const state = await setup(page);
    await all(page).check(); await choice(page, 1).uncheck();
    if (reset === 'clear') await action(page, '清空选择').click();
    else if (reset === 'source') await page.getByRole('combobox', { name: '来源', exact: true }).selectOption('other');
    else await page.getByRole('button', { name: '刷新列表', exact: true }).click();
    await expect(all(page)).not.toBeChecked(); await expect(page.locator('table.tracks tbody input:checked')).toHaveCount(0);
    expect(state.favoriteWrites).toEqual([]); expect(state.playlistWrites).toEqual([]); expect(state.matchingWrites).toEqual([]);
    expect(state.invalidSourceScopes).toEqual([]); expect(state.errors).toEqual([]);
  });
}
