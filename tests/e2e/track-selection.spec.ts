import { expect, test, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import type { Playlist } from '../../src/api/content';
import type { TrackSelection } from '../../src/api/track-selection';
import { routeApi } from '../fixtures/control-mock';
import { deferred, track } from '../fixtures/dto';

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
  sourceTrackId: `track-${index}`, assetId: `asset-${index}`, providerInstanceId: 'local',
  displayName: `Track ${index}.wav`,
}));
const titles = tracks.map((item) => item.displayName);
const all = (page: Page) => page.getByRole('checkbox', { name: '全选曲目', exact: true });
const choice = (page: Page, index: number) => page.getByRole('checkbox', { name: `选择 Track ${index}.wav`, exact: true });
const rows = (page: Page) => page.locator('table.tracks tbody > tr');
const action = (page: Page, name: string) => page.locator('.list-actions').getByRole('button', { name, exact: true });

async function setup(page: Page, failFavoriteOnce = false, favoriteResponse?: Promise<void>) {
  const requests: string[] = [], errors: string[] = [], singleFavoriteWrites: string[] = [];
  const selections: TrackSelection[] = [];
  const favoriteRequests: { selection: TrackSelection; favorite: boolean }[] = [];
  const playlistWrites: { selection: TrackSelection; name?: string; expectedRevision?: number; key: string | undefined; playlistId?: string }[] = [];
  const matchingWrites: { selection: TrackSelection; expectedRevision: number; targetRecordingId: string | null; sourceTrackIds?: string[] }[] = [];
  const playlists: Playlist[] = [];
  const favorites = new Set<string>();
  let favoriteReads = 0, failed = false;
  const selected = (selection: TrackSelection) => tracks.filter((item) => selection.batch
    ? !selection.exclude?.includes(item.sourceTrackId) : selection.sourceTrackIds?.includes(item.sourceTrackId));
  page.on('pageerror', (error) => errors.push(error.message));
  await routeApi(page, async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (path.endsWith('/source-tracks')) {
      const cursor = url.searchParams.get('cursor');
      requests.push(`${url.searchParams.get('providerInstanceId') ?? 'all'}:${cursor ?? 'first'}`);
      if (url.searchParams.get('providerInstanceId') === 'other') {
        const other = { ...tracks[0], sourceTrackId: 'other-track', displayName: 'Other.wav', providerInstanceId: 'other' };
        return route.fulfill({ json: { items: [{ ...other, versions: [other] }], nextCursor: null,
          libraryRevision: '1', matchingRevision: 1 } });
      }
      const offset = cursor ? Number(cursor.slice(1)) : 0;
      return route.fulfill({ json: { items: tracks.slice(offset, offset + pageSize).map((item) => ({ ...item, versions: [item] })),
        nextCursor: offset + pageSize < tracks.length ? `c${offset + pageSize}` : null, libraryRevision: '1', matchingRevision: 1 } });
    }
    if (path.endsWith('/source-tracks/selection')) {
      const selection = request.postDataJSON() as TrackSelection; selections.push(selection);
      return route.fulfill({ json: { items: selected(selection), total: selected(selection).length } });
    }
    if (path.endsWith('/me/favorites/batch')) {
      const input = request.postDataJSON() as { selection: TrackSelection; favorite: boolean };
      favoriteRequests.push(input);
      if (failFavoriteOnce && !failed) {
        failed = true;
        return route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: 'Offline' } } });
      }
      const sourceTrackIds = selected(input.selection).map((item) => item.sourceTrackId);
      sourceTrackIds.forEach((id) => input.favorite ? favorites.add(id) : favorites.delete(id));
      await favoriteResponse;
      return route.fulfill({ json: { affected: sourceTrackIds.length, sourceTrackIds } });
    }
    const favorite = /\/me\/favorites\/(track-\d+)$/.exec(path);
    if (favorite && (method === 'PUT' || method === 'DELETE')) {
      singleFavoriteWrites.push(favorite[1]);
      return route.fulfill({ status: 500, json: { error: { code: 'INVALID_REQUEST', message: 'Use the batch endpoint' } } });
    }
    if (path.endsWith('/me/favorites')) {
      favoriteReads++;
      return route.fulfill({ json: { items: [], nextCursor: null, revision: '1/1' } });
    }
    const playlistSelection = /\/playlists(?:\/([^/]+))?\/selection$/.exec(path);
    if (playlistSelection) {
      const input = request.postDataJSON() as { selection: TrackSelection; name?: string; expectedRevision?: number };
      const playlistId = playlistSelection[1];
      playlistWrites.push({ ...input, key: request.headers()['idempotency-key'], ...(playlistId ? { playlistId } : {}) });
      const result = playlistId ? playlists.find((item) => item.playlistId === playlistId)! : {
        playlistId: `playlist-${playlists.length + 1}`, name: input.name!, ruleRevision: 1,
        hideRevision: 0, snapshotRevision: 0, stale: true, bindings: [],
      };
      if (!playlistId) playlists.push(result); else result.ruleRevision++;
      return route.fulfill({ json: { playlistId: result.playlistId, ruleRevision: result.ruleRevision, count: selected(input.selection).length } });
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
  return { requests, errors, selections, favoriteRequests, singleFavoriteWrites, favorites,
    favoriteReads: () => favoriteReads, playlistWrites, matchingWrites };
}

async function expectQueue(page: Page, expected: string[]) {
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await expect(page.locator('.queue-list button')).toHaveText(expected);
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
}
function expectBatch(selection: TrackSelection, excluded: string[] = []) {
  expect(selection).toMatchObject({ batch: true, exclude: excluded, groupBy: 'recording', libraryRevision: '1', matchingRevision: 1 });
  expect(selection.sourceTrackIds).toBeUndefined();
}

test('select all persists across natural page appends and sends exclusions without fetching the remaining pages', async ({ page }) => {
  const state = await setup(page);
  await expect(all(page)).toHaveAttribute('title', '选择当前列表的全部曲目，包括尚未加载的曲目');
  await all(page).check(); await choice(page, 1).uncheck();
  expect(state.requests).toEqual(['all:first']);
  await expect(all(page)).toBeChecked({ indeterminate: true });
  await page.locator('#page-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(rows(page)).toHaveCount(pageSize * 2);
  await expect(choice(page, 40)).toBeChecked(); await expect(choice(page, 1)).not.toBeChecked();
  await action(page, '加入队列').click();
  await expectQueue(page, titles.filter((_, index) => index !== 1));
  expectBatch(state.selections[0], ['track-1']);
  expect(state.requests).toEqual(['all:first', 'all:c40']);
  expect(state.errors).toEqual([]);
});

test('selected row context actions send a batch scope without fetching full track pages', async ({ page }) => {
  const state = await setup(page);
  await all(page).check(); await rows(page).first().click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: '添加到播放列表', exact: true }).click();
  await expectQueue(page, titles);
  expect(state.selections).toHaveLength(1); expectBatch(state.selections[0]);
  expect(state.requests).toEqual(['all:first']);
  expect(state.errors).toEqual([]);
});

test('playlist creation and append send the batch selection and idempotency key directly', async ({ page }) => {
  const state = await setup(page);
  await all(page).check(); await choice(page, 2).uncheck();
  await action(page, '添加到歌单').click();
  const dialog = page.getByRole('dialog', { name: '添加到歌单', exact: true });
  await expect(dialog.getByText('全部选中曲目', { exact: true })).toBeVisible();
  await dialog.getByLabel('歌单名称', { exact: true }).fill('All selected tracks');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expectBatch(state.playlistWrites[0].selection, ['track-2']);
  expect(state.playlistWrites[0].name).toBe('All selected tracks');
  expect(state.playlistWrites[0].key).toBeTruthy();
  await action(page, '添加到歌单').click();
  await dialog.getByLabel('目标歌单', { exact: true }).selectOption('playlist-1');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.playlistWrites[1]).toMatchObject({ playlistId: 'playlist-1', expectedRevision: 1 });
  expectBatch(state.playlistWrites[1].selection, ['track-2']);
  expect(state.playlistWrites[1].key).toBeTruthy();
  expect(state.requests).toEqual(['all:first']); expect(state.selections).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('batch favorite failure preserves selection and retry performs one bulk write without reloading favorites', async ({ page }) => {
  const state = await setup(page, true);
  await all(page).check(); await choice(page, 3).uncheck();
  const initialFavoriteReads = state.favoriteReads();
  await action(page, '收藏').click();
  await expect(page.getByRole('alert').first()).toBeVisible(); await expect(action(page, '收藏')).toBeEnabled();
  expect(state.favorites.size).toBe(0); expect(state.favoriteRequests).toHaveLength(1);
  await action(page, '收藏').click();
  await expect.poll(() => state.favorites.size).toBe(tracks.length - 1);
  await expect(page.getByRole('button', { name: '取消收藏 Track 0.wav', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '收藏 Track 3.wav', exact: true })).toBeVisible();
  expect(state.favoriteRequests).toHaveLength(2); expectBatch(state.favoriteRequests[1].selection, ['track-3']);
  expect(state.favoriteReads()).toBe(initialFavoriteReads); expect(state.singleFavoriteWrites).toEqual([]);
  expect(state.requests).toEqual(['all:first']); expect(state.selections).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('clearing selection during a pending batch favorite keeps the successful result without loading full lists', async ({ page }) => {
  const response = deferred<void>();
  const state = await setup(page, false, response.promise);
  await all(page).check(); await choice(page, 5).uncheck();
  const initialFavoriteReads = state.favoriteReads();
  await action(page, '收藏').click();
  await expect.poll(() => state.favoriteRequests.length).toBe(1);
  expect(state.favorites.size).toBe(tracks.length - 1);
  // 服务端已应用收藏但响应尚未到达，清空只改变勾选范围。
  await action(page, '清空选择').click();
  await expect(all(page)).not.toBeChecked();
  await expect(page.locator('table.tracks tbody input:checked')).toHaveCount(0);
  response.resolve();
  await expect(page.getByRole('button', { name: '取消收藏 Track 0.wav', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '收藏 Track 5.wav', exact: true })).toBeVisible();
  await expect(rows(page).locator('button[aria-pressed="true"]')).toHaveCount(pageSize - 1);
  await expect(all(page)).not.toBeChecked();
  await expect(page.locator('table.tracks tbody input:checked')).toHaveCount(0);
  expectBatch(state.favoriteRequests[0].selection, ['track-5']);
  expect(state.favoriteRequests).toHaveLength(1); expect(state.singleFavoriteWrites).toEqual([]);
  expect(state.favoriteReads()).toBe(initialFavoriteReads);
  expect(state.requests).toEqual(['all:first']); expect(state.selections).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('merge confirmation sends a batch selection without expanding source versions', async ({ page }) => {
  const state = await setup(page);
  await all(page).check(); await choice(page, 4).uncheck(); await action(page, '合并歌曲').click();
  const dialog = page.getByRole('dialog', { name: '合并歌曲', exact: true });
  await expect(dialog.getByText('全部选中曲目', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '确认合并', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.matchingWrites).toHaveLength(1); expectBatch(state.matchingWrites[0].selection, ['track-4']);
  expect(state.matchingWrites[0].sourceTrackIds).toBeUndefined();
  expect(state.requests.every((request) => request === 'all:first')).toBe(true);
  expect(state.selections).toEqual([]); expect(state.errors).toEqual([]);
});

for (const reset of ['clear', 'source', 'refresh'] as const) {
  test(`${reset} resets the saved selection scope before any batch operation is submitted`, async ({ page }) => {
    const state = await setup(page);
    await all(page).check(); await choice(page, 1).uncheck();
    if (reset === 'clear') await action(page, '清空选择').click();
    else if (reset === 'source') await page.getByRole('combobox', { name: '来源', exact: true }).selectOption('other');
    else await page.getByRole('button', { name: '刷新列表', exact: true }).click();
    await expect(all(page)).not.toBeChecked(); await expect(page.locator('table.tracks tbody input:checked')).toHaveCount(0);
    if (reset === 'clear') {
      await page.locator('#page-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expect(rows(page)).toHaveCount(pageSize * 2); await expect(choice(page, 40)).not.toBeChecked();
    }
    expect(state.selections).toEqual([]); expect(state.favoriteRequests).toEqual([]);
    expect(state.playlistWrites).toEqual([]); expect(state.matchingWrites).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}
