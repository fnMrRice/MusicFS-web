import { musicPage } from "../fixtures/music-catalog";
import { routeApi } from "../fixtures/control-mock";
import { expect, test, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { deferred, playback, track } from '../fixtures/dto';
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

async function setup(page: Page, count = 3, failPlayback = false) {
  const creates: string[] = [], errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // 固定随机源，让队列重排与随机切歌的断言可重复。
  await page.addInitScript(() => { Math.random = () => 0; });
  const sound = tone();
  await routeApi(page, async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range ?? '');
      if (!range) return route.fulfill({ contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: sound });
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), sound.length - 1) : sound.length - 1;
      return route.fulfill({ status: 206, contentType: 'audio/wav',
        headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${sound.length}` }, body: sound.subarray(start, end + 1) });
    }
    if (request.method() === 'DELETE') return route.fulfill({ status: 204 });
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: '1' };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', ready: true, apiVersion: '1', instanceId: 'playback-modes' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'fixture', user: { id: 'listener', role: 'user' } };
    if (path.endsWith('/library/tracks')) json = musicPage(titles.slice(0, count).map((displayName, index) => ({
      ...track, sourceTrackId: `track-${index + 1}`, assetId: `asset-${index + 1}`, displayName,
    })));
    if (path.endsWith('/playback/sessions') && request.method() === 'POST') {
      creates.push(request.postDataJSON().sourceTrackId);
      if (failPlayback) return route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: 'Unavailable' } } });
      const attempt = `attempt-${creates.length}`;
      json = { ...playback(attempt), sessionId: `session-${creates.length}`,
        streamUrl: `/api/v1/playback/sessions/session-${creates.length}/attempts/${attempt}/stream` };
    }
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/library`);
  await expect(page.getByRole('button', { name: '账号菜单', exact: true })).toBeVisible();
  return { creates, errors };
}

const mode = (page: Page, name: string) => page.getByRole('button', { name: `播放模式：${name}`, exact: true });
async function setMode(page: Page, name: string): Promise<void> {
  const button = page.getByRole('button', { name: /^播放模式：/ });
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await mode(page, name).count()) return;
    await button.click();
  }
  await expect(mode(page, name)).toBeVisible();
}
async function playAll(page: Page): Promise<void> {
  await page.getByRole('button', { name: '播放全部', exact: true }).click();
  await waitPlaying(page);
}
async function finishTrack(page: Page): Promise<void> {
  // 让浏览器真实触发 ended，验证自然结束与手动切歌的区别。
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => { audio.currentTime = audio.duration - 0.05; });
}
const selected = (page: Page) => page.locator('.queue-list button.selected');

test('track rows show bouncing dots while waiting, moving bars while playing, and a static pause icon', async ({ page }) => {
  await setup(page);
  const stream = deferred<void>();
  await page.route('**/stream', async route => { await stream.promise; await route.fallback(); }, { times: 1 });
  const row = page.locator('.tracks tr').filter({ has: page.getByRole('button', { name: '播放 Alpha.wav', exact: true }) });
  try {
    await row.getByRole('button', { name: '播放 Alpha.wav', exact: true }).click();
    const dots = row.getByRole('img', { name: /正在加载|正在缓冲/ });
    await expect(dots).toBeVisible();
    await expect(dots.locator('span')).toHaveCount(3);
    await expect(dots.locator('span').first()).toHaveCSS('animation-name', 'track-dot-bounce');
  } finally {
    stream.resolve();
  }
  const bars = row.getByRole('img', { name: '正在播放', exact: true });
  await expect(bars).toBeVisible();
  await expect(bars.locator('span').first()).toHaveCSS('animation-name', 'track-bar-level');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(row.getByRole('img', { name: '已暂停' })).toBeVisible();
  await expect(bars).toHaveCount(0);
  await page.getByRole('button', { name: '播放 Beta.wav', exact: true }).click();
  await expect(row.locator('.row-number')).toHaveText('1');
});

test('playback mode cycles through all modes and empty or single queues cannot shuffle', async ({ page }) => {
  const { creates, errors } = await setup(page, 1);
  await expect(page.getByRole('button', { name: /^(停止|停止播放)$/ })).toHaveCount(0);
  for (const name of ['顺序播放', '列表循环', '单曲循环', '随机播放']) {
    await expect(mode(page, name)).toBeVisible();
    await mode(page, name).click();
  }
  await expect(mode(page, '顺序播放')).toBeVisible();
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await expect(page.getByRole('button', { name: '打乱队列', exact: true })).toBeDisabled();
  await expect(page.getByText('还没有加入曲目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.getByRole('button', { name: '加入队列', exact: true }).click();
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await expect(page.locator('.queue-list button')).toHaveText(['Alpha.wav']);
  await expect(page.getByRole('button', { name: '打乱队列', exact: true })).toBeDisabled();
  expect(creates).toEqual([]); expect(errors).toEqual([]);
});

test('sequential playback advances naturally and ends at the final queued track', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await playAll(page);
  await finishTrack(page);
  await expect.poll(() => creates).toEqual(['track-1', 'track-2']);
  await waitPlaying(page);
  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await waitPlaying(page);
  await expect.poll(() => creates).toEqual(['track-1', 'track-2', 'track-3']);
  await finishTrack(page);
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.ended)).toBe(true);
  await expect(page.getByRole('button', { name: '下一首', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  expect(creates).toEqual(['track-1', 'track-2', 'track-3']); expect(errors).toEqual([]);
});

test('shuffling an unstarted queue changes its order without starting playback', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await page.getByRole('button', { name: '加入队列', exact: true }).click();
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  const buttons = page.locator('.queue-list button');
  await expect(buttons).toHaveText(titles);
  await page.getByRole('button', { name: '打乱队列', exact: true }).click();
  await expect.poll(() => buttons.allTextContents()).not.toEqual(titles);
  expect((await buttons.allTextContents()).sort()).toEqual([...titles].sort());
  await expect(selected(page)).toHaveCount(0);
  await expect(page.locator('audio')).toHaveCount(0);
  expect(creates).toEqual([]); expect(errors).toEqual([]);
});

test('list repeat wraps both manual previous and natural completion', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await setMode(page, '列表循环'); await playAll(page);
  await page.getByRole('button', { name: '上一首', exact: true }).click();
  await expect.poll(() => creates).toEqual(['track-1', 'track-3']);
  await waitPlaying(page); await finishTrack(page);
  await expect.poll(() => creates).toEqual(['track-1', 'track-3', 'track-1']);
  await waitPlaying(page);
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await expect(selected(page)).toHaveText('Alpha.wav');
  expect(errors).toEqual([]);
});

test('single repeat restarts on completion while manual next still changes tracks', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await setMode(page, '单曲循环'); await playAll(page); await finishTrack(page);
  await expect.poll(() => creates).toEqual(['track-1', 'track-1']);
  await waitPlaying(page);
  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await expect.poll(() => creates).toEqual(['track-1', 'track-1', 'track-2']);
  await waitPlaying(page);
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await expect(selected(page)).toHaveText('Beta.wav');
  expect(errors).toEqual([]);
});

test('random mode changes the current track for manual and natural transitions', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await setMode(page, '随机播放'); await playAll(page);
  for (let count = 2; count <= 4; count++) {
    if (count === 3) await finishTrack(page);
    else await page.getByRole('button', { name: '下一首', exact: true }).click();
    await expect.poll(() => creates.length).toBe(count);
    expect(creates[count - 1]).not.toBe(creates[count - 2]);
    await waitPlaying(page);
  }
  expect(creates.every((id) => ['track-1', 'track-2', 'track-3'].includes(id))).toBe(true);
  expect(errors).toEqual([]);
});

test('shuffling preserves queue members, current audio, selected item and pause state', async ({ page }, info) => {
  const { creates, errors } = await setup(page);
  await playAll(page);
  await page.getByRole('button', { name: '下一首', exact: true }).click(); await waitPlaying(page);
  const audio = page.locator('audio'), original = await audio.elementHandle();
  const src = await audio.getAttribute('src');
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await page.getByRole('button', { name: '固定播放队列', exact: true }).click();
  await expect(selected(page)).toHaveText('Beta.wav');
  const buttons = page.locator('.queue-list button');
  const before = await buttons.allTextContents();
  await page.getByRole('button', { name: '打乱队列', exact: true }).click();
  await expect.poll(() => buttons.allTextContents()).not.toEqual(before);
  expect((await buttons.allTextContents()).sort()).toEqual([...titles].sort());
  await expect(selected(page)).toHaveText('Beta.wav');
  await waitPlaying(page);
  expect(await original!.evaluate((element) => element === document.querySelector('audio'))).toBe(true);
  expect(await audio.getAttribute('src')).toBe(src);
  expect(creates).toEqual(['track-1', 'track-2']);
  await page.screenshot({ path: info.outputPath('desktop-shuffled-queue.png') });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const pausedAt = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
  await page.getByRole('button', { name: '打乱队列', exact: true }).click();
  await expect(selected(page)).toHaveText('Beta.wav');
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(pausedAt, 2);
  expect(await audio.getAttribute('src')).toBe(src);
  expect(creates).toEqual(['track-1', 'track-2']); expect(errors).toEqual([]);
});

test('mode and queue shuffle remain reachable on mobile and error messages have no stop button', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, 3, true);
  await expect(mode(page, '顺序播放')).toBeInViewport();
  await page.getByRole('button', { name: '播放全部', exact: true }).click();
  await expect(page.getByRole('button', { name: '从头播放', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(停止|停止播放)$/ })).toHaveCount(0);
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await expect(page.getByRole('button', { name: '打乱队列', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '打乱队列', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile-playback-modes.png') });
});

test('time displays toggle independently without disturbing audio and retain their modes across tracks', async ({ page }) => {
  const { creates, errors } = await setup(page);
  const left = page.locator('.time button').nth(0), right = page.locator('.time button').nth(1);
  await expect(left).toHaveAccessibleName('当前时间，点击显示剩余时间');
  await expect(right).toHaveAccessibleName('总时间，点击显示剩余时间');
  await expect(right).toHaveText('—');
  await right.click();
  await expect(right).toHaveAccessibleName('剩余时间，点击显示总时间');
  await expect(right).toHaveText('—');
  await expect(page.locator('audio')).toHaveCount(0);
  expect(creates).toEqual([]);
  await right.press('Enter');

  await playAll(page);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const audio = page.locator('audio'), original = await audio.elementHandle();
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 12; });
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.seeking)).toBe(false);
  await expect(left).toHaveText('00:12');
  await expect(right).toHaveText('00:30');
  const src = await audio.getAttribute('src');
  // 时间显示操作不应触发播放、定位或重新加载音频。
  const sideEffects = await audio.evaluateHandle((element) => {
    const events: string[] = [];
    for (const type of ['play', 'playing', 'seeking', 'loadstart', 'emptied']) {
      element.addEventListener(type, () => events.push(type));
    }
    return events;
  });
  await left.click();
  await expect(left).toHaveAccessibleName('剩余时间，点击显示当前时间');
  await expect(left).toHaveText('-00:18');
  await expect(right).toHaveText('00:30');
  await right.press('Space');
  await expect(right).toHaveText('-00:18');
  await expect(left).toHaveText('-00:18');
  await left.press('Enter');
  await expect(left).toHaveText('00:12');
  await expect(right).toHaveText('-00:18');
  await right.click();
  await expect(right).toHaveText('00:30');
  await left.click();
  await right.click();
  expect(await original!.evaluate((element) => element === document.querySelector('audio'))).toBe(true);
  expect(await audio.getAttribute('src')).toBe(src);
  expect(await audio.evaluate((element: HTMLAudioElement) => ({ paused: element.paused, time: element.currentTime })))
    .toEqual({ paused: true, time: 12 });
  expect(await sideEffects.jsonValue()).toEqual([]);
  expect(creates).toEqual(['track-1']);

  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await waitPlaying(page);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 8; });
  await expect(left).toHaveAccessibleName('剩余时间，点击显示当前时间');
  await expect(right).toHaveAccessibleName('剩余时间，点击显示总时间');
  await expect(left).toHaveText('-00:22');
  await expect(right).toHaveText('-00:22');
  expect(creates).toEqual(['track-1', 'track-2']);
  expect(errors).toEqual([]);
});
