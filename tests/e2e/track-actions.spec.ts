import { musicPage, musicTrack } from "../fixtures/music-catalog";
import { routeApi } from "../fixtures/control-mock";
import { expect, test, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import type { Binding, Playlist } from '../../src/api/content';
import { playback, track } from '../fixtures/dto';
import { waitPlaying } from './helpers';

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Preview address unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const titles = ['Alpha.wav', 'Beta.wav', 'Gamma.wav'];
const actions = ['播放', '下一首播放', '添加到播放列表', '收藏', '添加到歌单', '搜索在线资料', '编辑曲目元数据'];
function tone(): Buffer {
  const rate = 8000, frames = rate * 30, bytes = frames * 2;
  const data = Buffer.alloc(44 + bytes);
  data.write('RIFF', 0); data.writeUInt32LE(36 + bytes, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40);
  for (let frame = 0; frame < frames; frame++) data.writeInt16LE(Math.round(4000 * Math.sin(2 * Math.PI * 440 * frame / rate)), 44 + frame * 2);
  return data;
}

async function setup(page: Page, missingLast = false) {
  const creates: string[] = [], errors: string[] = [], favoriteWrites: string[] = [];
  const favorites = new Set<string>(), playlists: Playlist[] = [];
  const playlistWrites: { name: string; bindings: Binding[] }[] = [];
  const tracks = titles.map((displayName, index) => ({ ...track, displayName,
    sourceTrackId: `track-${index + 1}`, assetId: `asset-${index + 1}`,
    availability: missingLast && index === 2 ? 'missing' : 'available',
  }));
  let revision = 1;
  page.on('pageerror', (error) => errors.push(error.message));
  const sound = tone();
  await routeApi(page, async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (path.endsWith('/stream')) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range ?? '');
      if (!range) return route.fulfill({ contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: sound });
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), sound.length - 1) : sound.length - 1;
      return route.fulfill({ status: 206, contentType: 'audio/wav',
        headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${sound.length}` }, body: sound.subarray(start, end + 1) });
    }
    const favorite = /\/me\/favorites\/(track-\d+)$/.exec(path);
    if (favorite && (method === 'PUT' || method === 'DELETE')) {
      // 保留在路由闭包中的账号数据，使整页刷新真正重新从服务端读取收藏。
      expect(request.postData()).toBeNull();
      favoriteWrites.push(`${method} ${favorite[1]}`);
      if (method === 'DELETE') {
        favorites.delete(favorite[1]); revision++;
        return route.fulfill({ status: 204 });
      }
      favorites.add(favorite[1]); revision++;
      const selected = tracks.find((item) => item.sourceTrackId === favorite[1])!;
      return route.fulfill({ json: { track: selected, musicTrack: musicTrack(selected), forcedSourceTrackId: null, recordedAt: '2026-10-22T00:00:00Z' } });
    }
    if (path.endsWith('/me/favorites')) return route.fulfill({ json: {
      items: tracks.filter((item) => favorites.has(item.sourceTrackId)).map((item) => ({ track: item, musicTrack: musicTrack(item), forcedSourceTrackId: null, recordedAt: '2026-10-22T00:00:00Z' })),
      nextCursor: null, revision: `${revision}/1`,
    } });
    if (path.endsWith('/playlists')) {
      if (method === 'POST') {
        const input = request.postDataJSON() as { name: string; bindings: Binding[] };
        playlistWrites.push(input);
        const result: Playlist = { ...input, playlistId: `playlist-${playlists.length + 1}`,
          ruleRevision: 1, hideRevision: 0, snapshotRevision: 0, stale: true };
        playlists.push(result);
        return route.fulfill({ json: result });
      }
      return route.fulfill({ json: { items: playlists, nextAfter: null } });
    }
    if (method === 'DELETE') return route.fulfill({ status: 204 });
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: '1' };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', ready: true, apiVersion: '1', instanceId: 'track-actions' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'fixture', user: { id: 'listener', role: 'user' } };
    if (path.endsWith('/library/tracks')) json = musicPage(tracks);
    if (path.endsWith('/playback/sessions') && method === 'POST') {
      const sourceTrackId = request.postDataJSON().sourceTrackId as string;
      creates.push(sourceTrackId);
      const attempt = `attempt-${creates.length}`;
      json = { ...playback(attempt), sourceTrackId, assetId: tracks.find((item) => item.sourceTrackId === sourceTrackId)?.assetId,
        sessionId: `session-${creates.length}`, streamUrl: `/api/v1/playback/sessions/session-${creates.length}/attempts/${attempt}/stream` };
    }
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/library`);
  await expect(page.getByRole('button', { name: '账号菜单', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 Alpha.wav', exact: true })).toBeVisible();
  return { creates, errors, favorites, favoriteWrites, playlistWrites };
}

const row = (page: Page, title: string) => page.locator('table.tracks tbody > tr').filter({ has: page.getByRole('button', { name: `播放 ${title}`, exact: true }) });
const menu = (page: Page) => page.getByRole('menu');
const item = (page: Page, name: string) => menu(page).getByRole('menuitem', { name, exact: true });
async function rightClick(page: Page, title: string): Promise<void> {
  await row(page, title).click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
}
async function queue(page: Page, expected: string[], selected?: string): Promise<void> {
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await expect(page.locator('.queue-list button')).toHaveText(expected);
  if (selected) await expect(page.locator('.queue-list button.selected')).toHaveText(selected);
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
}

test('track titles and context play append to the existing queue and start the chosen track', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await page.getByRole('button', { name: '播放 Alpha.wav', exact: true }).click();
  await waitPlaying(page);
  await page.getByRole('button', { name: '播放 Beta.wav', exact: true }).click();
  await expect(page.locator('.now-playing strong')).toHaveText('Beta.wav');
  await waitPlaying(page);
  await queue(page, ['Alpha.wav', 'Beta.wav'], 'Beta.wav');
  await rightClick(page, 'Gamma.wav');
  await expect(menu(page).getByRole('menuitem')).toHaveText(actions);
  await item(page, '播放').click();
  await expect(page.locator('.now-playing strong')).toHaveText('Gamma.wav');
  await waitPlaying(page);
  await queue(page, titles, 'Gamma.wav');
  expect(creates).toEqual(['track-1', 'track-2', 'track-3']);
  expect(errors).toEqual([]);
});

test('play next inserts after the current track without replacing or restarting its audio', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await page.getByRole('button', { name: '播放 Alpha.wav', exact: true }).click();
  await waitPlaying(page);
  const audio = page.locator('audio'), original = await audio.elementHandle(), src = await audio.getAttribute('src');
  await rightClick(page, 'Gamma.wav'); await item(page, '添加到播放列表').click();
  await rightClick(page, 'Beta.wav'); await item(page, '下一首播放').click();
  await queue(page, titles, 'Alpha.wav');
  expect(creates).toEqual(['track-1']);
  expect(await original!.evaluate((element) => element === document.querySelector('audio'))).toBe(true);
  expect(await audio.getAttribute('src')).toBe(src);
  await waitPlaying(page);
  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await expect.poll(() => creates).toEqual(['track-1', 'track-2']);
  await waitPlaying(page);
  expect(errors).toEqual([]);
});

test('favorite and unfavorite use account storage and survive a full reload', async ({ page }) => {
  const { favorites, favoriteWrites, errors } = await setup(page);
  await rightClick(page, 'Alpha.wav');
  await expect(item(page, '收藏')).toBeEnabled(); await item(page, '收藏').click();
  await expect.poll(() => [...favorites]).toEqual(['track-1']);
  await page.reload();
  await rightClick(page, 'Alpha.wav');
  await expect(item(page, '取消收藏')).toBeEnabled(); await item(page, '取消收藏').click();
  await expect.poll(() => [...favorites]).toEqual([]);
  await page.reload();
  await rightClick(page, 'Alpha.wav');
  await expect(item(page, '收藏')).toBeEnabled();
  expect(favoriteWrites).toEqual(['PUT track-1', 'DELETE track-1']);
  expect(errors).toEqual([]);
});

test('the player heart follows the current track and stays in sync with library favorites', async ({ page }) => {
  const { favoriteWrites, creates, errors } = await setup(page);
  const player = page.getByRole('region', { name: '播放器', exact: true });
  const heart = player.getByRole('button', { name: /收藏/ });
  const alpha = row(page, 'Alpha.wav').getByRole('button', { name: /收藏/ });
  await expect(heart).toBeDisabled();
  await alpha.click();
  await page.reload();
  await page.getByRole('button', { name: '播放 Alpha.wav', exact: true }).click();
  await waitPlaying(page);
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  const accent = await alpha.evaluate(button => getComputedStyle(button).color);
  await expect(heart.locator('path')).toHaveCSS('fill', accent);
  await heart.click();
  await expect(alpha).toHaveAttribute('aria-pressed', 'false');
  await expect(heart.locator('path')).toHaveCSS('fill', 'none');
  await alpha.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: '播放 Beta.wav', exact: true }).click();
  await expect(player.locator('.now-playing strong')).toHaveText('Beta.wav');
  await waitPlaying(page);
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await expect(heart.locator('path')).toHaveCSS('fill', 'none');
  await heart.click();
  await expect(row(page, 'Beta.wav').getByRole('button', { name: /收藏/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(heart.locator('path')).toHaveCSS('fill', accent);
  await page.reload();
  await expect(player.locator('.now-playing strong')).toHaveText('Beta.wav');
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('audio')).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(heart).toBeInViewport({ ratio: 1 });
  const heartBox = (await heart.boundingBox())!;
  const modeBox = (await player.getByRole('button', { name: /播放模式/ }).boundingBox())!;
  expect(heartBox.x + heartBox.width).toBeLessThanOrEqual(modeBox.x);
  expect(favoriteWrites).toEqual(['PUT track-1', 'DELETE track-1', 'PUT track-1', 'PUT track-2']);
  expect(creates).toEqual(['track-1', 'track-2']);
  expect(errors).toEqual([]);
});

test('right clicking a selected row applies queue and playlist actions to the full selection', async ({ page }) => {
  const { creates, errors, playlistWrites } = await setup(page);
  await page.getByRole('checkbox', { name: '选择 Alpha.wav', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择 Beta.wav', exact: true }).check();
  await rightClick(page, 'Beta.wav');
  await expect(menu(page)).toHaveAccessibleName('已选择 2 首');
  await item(page, '添加到播放列表').click();
  await queue(page, ['Alpha.wav', 'Beta.wav']);
  expect(creates).toEqual([]);
  await rightClick(page, 'Alpha.wav'); await item(page, '添加到歌单').click();
  const dialog = page.getByRole('dialog', { name: '添加到歌单', exact: true });
  await expect(dialog.getByText('将 2 首曲目保存为歌单引用。', { exact: true })).toBeVisible();
  await dialog.getByLabel('歌单名称', { exact: true }).fill('Selected tracks');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(playlistWrites).toEqual([{ name: 'Selected tracks', bindings: [{ kind: 'local', entries: [
    { source: { trackId: 'track-1', forcedSourceTrackId: null, sourceTrackId: null, remoteSourceId: null } },
    { source: { trackId: 'track-2', forcedSourceTrackId: null, sourceTrackId: null, remoteSourceId: null } },
  ] }] }]);
  // 未选中的行有独立目标，不能误操作先前勾选的集合。
  await rightClick(page, 'Gamma.wav');
  await expect(menu(page)).toHaveAccessibleName('Gamma.wav');
  await item(page, '添加到播放列表').click();
  await queue(page, titles);
  expect(errors).toEqual([]);
});

test('menus support more buttons and keyboard dismissal, stay onscreen and disable unavailable playback', async ({ page }) => {
  const { errors } = await setup(page, true);
  const more = page.getByRole('button', { name: 'Alpha.wav 的更多操作', exact: true });
  await more.click();
  await expect(menu(page).getByRole('menuitem')).toHaveText(actions);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0); await expect(more).toBeFocused();
  await more.press('Shift+F10'); await expect(menu(page)).toBeVisible();
  await page.getByRole('button', { name: '全部曲目', exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
  const viewport = page.viewportSize()!;
  await row(page, 'Gamma.wav').evaluate((element, point) => element.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: point.x, clientY: point.y,
  })), { x: viewport.width - 2, y: viewport.height - 2 });
  await expect(menu(page)).toBeVisible();
  for (const name of actions.slice(0, 3)) await expect(item(page, name)).toBeDisabled();
  await expect(item(page, '收藏')).toBeEnabled();
  await expect(item(page, '添加到歌单')).toBeEnabled();
  const bounds = await menu(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  expect(errors).toEqual([]);
});

test('row actions share one horizontal cell and directly toggle favorites and play next', async ({ page }, info) => {
  const { favorites, creates, errors } = await setup(page, true);
  const cell = row(page, 'Alpha.wav').locator('td').last();
  const buttons = cell.getByRole('button');
  await expect(buttons).toHaveCount(4);
  const labels = await buttons.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')));
  expect(labels).toEqual(['收藏 Alpha.wav', '将 Alpha.wav 设为下一首播放', '将 Alpha.wav 添加到歌单', 'Alpha.wav 的更多操作']);
  const positions = await buttons.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y };
  }));
  for (let i = 1; i < positions.length; ++i) {
    expect(positions[i].x).toBeGreaterThan(positions[i - 1].x);
    expect(positions[i].y).toBe(positions[0].y);
  }
  await buttons.nth(0).click();
  await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'true');
  expect([...favorites]).toEqual(['track-1']);
  await buttons.nth(0).click();
  await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'false');
  expect([...favorites]).toEqual([]);
  await page.getByRole('button', { name: '播放 Alpha.wav', exact: true }).click();
  await waitPlaying(page);
  await page.getByRole('button', { name: '将 Beta.wav 设为下一首播放', exact: true }).click();
  await queue(page, ['Alpha.wav', 'Beta.wav'], 'Alpha.wav');
  expect(creates).toEqual(['track-1']);
  await expect(page.getByRole('button', { name: '将 Gamma.wav 设为下一首播放', exact: true })).toBeDisabled();
  await buttons.nth(3).click();
  await expect(menu(page)).toBeVisible();
  await page.screenshot({ path: info.outputPath('track-row-actions.png') });
  expect(errors).toEqual([]);
});
