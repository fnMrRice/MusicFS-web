import { musicPage } from "../fixtures/music-catalog";
import { routeApi } from "../fixtures/control-mock";
import { expect, test, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { playback, track } from '../fixtures/dto';
import { waitPlaying } from './helpers';

let server: PreviewServer;
let origin: string;
const preferenceKey = 'musicfs:lyrics-panel:listener:preferences';
test.beforeAll(async () => {
  server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Preview address unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

function sound(): Buffer {
  const bytes = 8000 * 60 * 2, data = Buffer.alloc(44 + bytes);
  data.write('RIFF', 0); data.writeUInt32LE(36 + bytes, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40);
  return data;
}

async function setup(page: Page) {
  const creates: string[] = [], errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const wav = sound();
  await routeApi(page, async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range ?? '');
      const headers = { 'Accept-Ranges': 'bytes' };
      if (!range) return route.fulfill({ contentType: 'audio/wav', headers, body: wav });
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
      return route.fulfill({ status: 206, contentType: 'audio/wav',
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${wav.length}` }, body: wav.subarray(start, end + 1) });
    }
    const media = /\/media\/lyrics-(.+)$/.exec(path);
    if (media) return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: `${media[1]} 第一行\n${media[1]} 第二行` });
    if (/\/media\/artwork-.+$/.test(path)) return route.fulfill({ contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=', 'base64') });
    if (request.method() === 'DELETE') return route.fulfill({ status: 204 });
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: '1' };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', ready: true, apiVersion: '1', instanceId: 'lyrics-panel' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'fixture', user: { id: 'listener', role: 'user' } };
    if (path.endsWith('/library/tracks')) json = musicPage(['Alpha', 'Beta'].map((name) => ({
      ...track, sourceTrackId: name, assetId: name, displayName: `${name}.wav`, durationMs: 60000,
    })));
    const selection = /\/source-tracks\/([^/]+)\/media-selection$/.exec(path);
    if (selection) json = { bindings: [
      { objectId: `lyrics-${selection[1]}`, field: 'lyrics', current: true, state: 'available' },
      { objectId: `artwork-${selection[1]}`, field: 'artwork', current: true, state: 'available' },
    ] };
    if (path.endsWith('/playback/sessions') && request.method() === 'POST') {
      creates.push(request.postDataJSON().sourceTrackId);
      json = { ...playback(`attempt-${creates.length}`), seekableRange: { startMs: 0, endMs: 60000 } };
    }
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/library`);
  await expect(page.getByRole('button', { name: '账号菜单', exact: true })).toBeVisible();
  return { creates, errors };
}

const lyrics = (page: Page) => page.getByRole('button', { name: '歌词', exact: true });
const panel = (page: Page) => page.locator('.player-panel');
const queue = (page: Page) => page.getByRole('button', { name: '播放队列', exact: true });
const preferences = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), preferenceKey);
async function play(page: Page, name = 'Alpha'): Promise<void> {
  await page.getByRole('button', { name: `播放 ${name}.wav`, exact: true }).click(); await waitPlaying(page);
}
async function expectLyrics(page: Page, name = 'Alpha'): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '歌词', exact: true });
  await expect(dialog.getByRole('heading', { name: '歌词', exact: true })).toBeVisible();
  await expect(dialog.locator('.lyrics')).toHaveText(`${name} 第一行\n${name} 第二行`);
  await expect(dialog.locator('.media-artwork')).toHaveCount(0);
  await expect(dialog).not.toContainText('暂无歌词');
  await expect(dialog).not.toContainText('此曲目暂无可用歌词。');
  await expect(dialog).not.toContainText('展示当前来源已选用的歌词；暂不进行逐句定位。');
  await expect(lyrics(page)).toHaveAttribute('aria-expanded', 'true');
}
async function openPinned(page: Page): Promise<void> {
  await lyrics(page).click(); await expectLyrics(page);
  await page.getByRole('button', { name: '固定歌词', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消固定歌词', exact: true })).toBeVisible();
  await expect(lyrics(page)).toHaveAttribute('aria-pressed', 'true');
}
async function clickOutside(page: Page): Promise<void> {
  await page.getByRole('columnheader', { name: '曲名', exact: true }).click();
}

test('lyrics has the renamed entry and temporary panels close on outside clicks', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await expect(page.getByRole('button', { name: '歌词与封面', exact: true })).toHaveCount(0);
  await expect(lyrics(page)).toBeDisabled();
  await expect(panel(page)).toHaveCount(0);
  await play(page);
  await expect(panel(page)).toHaveCount(0);
  expect(await lyrics(page).getAttribute('aria-pressed')).toBeNull();
  const audio = page.locator('audio'), source = await audio.getAttribute('src');
  await lyrics(page).click(); await expectLyrics(page);
  await expect(page.getByRole('button', { name: '固定歌词', exact: true })).toBeVisible();
  await queue(page).click();
  await expect(page.getByRole('dialog', { name: '播放队列' })).toBeVisible();
  await expect(lyrics(page)).toHaveAttribute('aria-expanded', 'false');
  await lyrics(page).click(); await expectLyrics(page);
  await expect(queue(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(panel(page)).toHaveCount(1);
  await clickOutside(page);
  await expect(panel(page)).toHaveCount(0);
  await expect(lyrics(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await audio.getAttribute('src')).toBe(source); expect(creates).toEqual(['Alpha']);
  expect(errors).toEqual([]);
});

test('pinned lyrics stays open outside, toggles visibility and unpins without closing', async ({ page }, info) => {
  const { creates, errors } = await setup(page);
  await play(page); await openPinned(page);
  await expect.poll(() => preferences(page)).toMatchObject({ lyricsPinned: true });
  await clickOutside(page); await expectLyrics(page);
  await page.screenshot({ path: info.outputPath('pinned-lyrics.png') });
  await lyrics(page).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(lyrics(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(lyrics(page)).toHaveAttribute('aria-expanded', 'false');
  await lyrics(page).click(); await expectLyrics(page);
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(lyrics(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => preferences(page)).toMatchObject({ lyricsPinned: true });
  await lyrics(page).click(); await expectLyrics(page);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(lyrics(page)).toHaveAttribute('aria-pressed', 'false');
  await lyrics(page).click(); await expectLyrics(page);
  await page.getByRole('button', { name: '取消固定歌词', exact: true }).click();
  await expectLyrics(page);
  expect(await lyrics(page).getAttribute('aria-pressed')).toBeNull();
  await expect.poll(() => preferences(page)).toMatchObject({ lyricsPinned: false });
  await clickOutside(page); await expect(panel(page)).toHaveCount(0);
  expect(creates).toEqual(['Alpha']); expect(errors).toEqual([]);
});

test('a pinned lyrics panel opens for the restored paused track after refresh', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await play(page); await openPinned(page);
  await page.reload();
  await expectLyrics(page, 'Alpha');
  await expect(page.locator('audio')).toHaveCount(0);
  expect(creates).toEqual(['Alpha']);
  await expect.poll(() => preferences(page)).toMatchObject({ lyricsPinned: true });
  await play(page, 'Beta'); await expectLyrics(page, 'Beta');
  await expect(lyrics(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '取消固定歌词', exact: true })).toBeVisible();
  await clickOutside(page); await expectLyrics(page, 'Beta');
  expect(creates).toEqual(['Alpha', 'Beta']); expect(errors).toEqual([]);
});

test('pinned lyrics and a temporary queue can be opened in either order', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await play(page); await openPinned(page);
  const queueDialog = page.getByRole('dialog', { name: '播放队列', exact: true });
  await queue(page).click();
  await expect(queueDialog).toBeVisible(); await expectLyrics(page);
  await clickOutside(page);
  await expect(queueDialog).toHaveCount(0); await expectLyrics(page);
  await lyrics(page).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(lyrics(page)).toHaveAttribute('aria-pressed', 'false');
  await queue(page).click();
  await expect(queueDialog).toBeVisible(); await expect(panel(page)).toHaveCount(1);
  await lyrics(page).click();
  await expect(queueDialog).toBeVisible(); await expectLyrics(page);
  await page.keyboard.press('Escape');
  await expect(queueDialog).toHaveCount(0); await expectLyrics(page);
  await lyrics(page).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(lyrics(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => preferences(page)).toMatchObject({ lyricsPinned: true });
  expect(creates).toEqual(['Alpha']); expect(errors).toEqual([]);
});

test('NetEase credits and LRC lyrics follow playback across seeks', async ({ page }) => {
  const { errors } = await setup(page);
  const imagePath = 'p1.music.126.net/bb0rolxzFDxg0iqJHdOpZQ==/109951172856616911.jpg';
  const artist = String.raw`{"tx":"兰音Reine","li":"http\://${imagePath}","or":"orpheus\://nm/artist/home?id=46424022&type=artist"}`;
  const source = [
    `{"t":0,"c":[{"tx":"作词: "},${artist}]}\\`,
    `{"t":1000,"c":[{"tx":"作曲: "},${artist}]}`,
    '{"t":1800,"c":null}',
    '[00:03.25]第一句歌词',
  ].join('\r\n');
  await page.route('**/media/lyrics-Alpha', route => route.fulfill({ contentType: 'text/plain; charset=utf-8', body: source }));
  let imageRequests = 0;
  await page.route(`https://${imagePath}`, route => { ++imageRequests; return route.abort(); });
  await play(page);
  const audio = page.locator('audio');
  await audio.evaluate((element: HTMLAudioElement) => { element.pause(); element.currentTime = 0; });
  await lyrics(page).click();
  const dialog = page.getByRole('dialog', { name: '歌词', exact: true });
  const current = dialog.locator('[aria-current="time"]');
  await expect(current).toHaveText('作词: 兰音Reine');
  await expect(current).toHaveCSS('text-align', 'center');
  await expect.poll(() => imageRequests).toBeGreaterThan(0);
  await expect(current.locator('img')).not.toBeVisible();
  await expect(current.getByRole('link', { name: '兰音Reine' })).toHaveAttribute('href', 'https://music.163.com/artist?id=46424022');
  await expect(dialog.getByText('{"t":1800,"c":null}', { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText('orpheus');

  for (const [seconds, line] of [[1, '作曲: 兰音Reine'], [3.25, '第一句歌词'], [0.5, '作词: 兰音Reine']] as const) {
    await audio.evaluate((element: HTMLAudioElement, time) => { element.currentTime = time; }, seconds);
    await expect(current).toHaveText(line);
  }
  expect(errors).toEqual([]);
});

test('lyrics follows the current line until the listener scrolls away', async ({ page }) => {
  const { errors } = await setup(page);
  const source = Array.from({ length: 60 }, (_, sec) => `[00:${String(sec).padStart(2, '0')}.00]第 ${sec} 行`).join('\n');
  await page.route('**/media/lyrics-Alpha', route => route.fulfill({ contentType: 'text/plain; charset=utf-8', body: source }));
  await play(page);
  const audio = page.locator('audio');
  await audio.evaluate((element: HTMLAudioElement) => { element.pause(); element.currentTime = 0; });
  await lyrics(page).click();
  const dialog = page.getByRole('dialog', { name: '歌词', exact: true });
  const title = dialog.getByRole('heading', { name: '歌词', exact: true });
  const current = dialog.locator('[aria-current="time"]');
  const first = dialog.getByText('第 0 行', { exact: true });
  const middle = dialog.getByText('第 35 行', { exact: true });
  await expect(middle).toHaveCSS('text-align', 'center');
  await expect(first).toBeInViewport({ ratio: 1 });
  await expect(middle).not.toBeInViewport();
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 35; });
  await expect(current).toHaveText('第 35 行');
  await expect(middle).toBeInViewport({ ratio: 1 });
  await expect(title).toBeInViewport({ ratio: 1 });
  const normalSize = await first.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const normalColor = await first.evaluate(el => getComputedStyle(el).color);
  await expect.poll(() => middle.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(normalSize);
  await expect(middle).not.toHaveCSS('color', normalColor);

  await middle.hover();
  await page.mouse.wheel(0, -8000);
  await expect(first).toBeInViewport({ ratio: 1 });
  await expect(current).not.toBeInViewport();
  const resume = dialog.getByRole('button', { name: '回到当前歌词', exact: true });
  await expect(resume).toBeInViewport({ ratio: 1 });
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect(current).toHaveText('第 36 行');
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  await expect(first).toBeInViewport({ ratio: 1 });
  await expect(current).not.toBeInViewport();
  await expect(title).toBeInViewport({ ratio: 1 });
  await resume.click();
  await expect(current).toBeInViewport({ ratio: 1 });
  await expect(title).toBeInViewport({ ratio: 1 });
  expect(errors).toEqual([]);
});
