import { routeApi } from "../fixtures/control-mock";
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { playback, track } from '../fixtures/dto';
import { waitPlaying } from './helpers';

let server: PreviewServer;
let origin: string;
const preferenceKey = 'musicfs:queue-panel:listener:preferences';
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
async function setup(page: Page, count = 2) {
  const creates: string[] = [], errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const wav = sound();
  const names = Array.from({ length: count }, (_, index) => index === 0 ? 'Alpha' : index === 1 ? 'Beta' : `Track ${index + 1}`);
  await routeApi(page, async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) return route.fulfill({ contentType: 'audio/wav', body: wav });
    if (path.endsWith('/media/lyrics-Alpha')) return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: 'Alpha 第一行\nAlpha 第二行' });
    if (request.method() === 'DELETE') return route.fulfill({ status: 204 });
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: '1' };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', ready: true, apiVersion: '1', instanceId: 'queue-panel' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'fixture', user: { id: 'listener', role: 'user' } };
    if (path.endsWith('/matching/revision')) json = { revision: 0, bulkMergeAvailable: true };
    if (path.endsWith('/source-tracks')) json = { items: names.map((name) => ({
      ...track, sourceTrackId: name, assetId: name, displayName: `${name}.wav`, durationMs: 60000,
    })), nextCursor: null, libraryRevision: '1' };
    if (path.endsWith('/media-selection')) json = { bindings: [{ objectId: 'lyrics-Alpha', field: 'lyrics', current: true, state: 'available' }] };
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
const queue = (page: Page) => page.getByRole('button', { name: '播放队列', exact: true });
const lyrics = (page: Page) => page.getByRole('button', { name: '歌词', exact: true });
const panel = (page: Page) => page.locator('.player-panel');
const close = (page: Page) => page.getByRole('button', { name: '关闭面板', exact: true });
const preferences = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), preferenceKey);
async function outside(page: Page): Promise<void> {
  await page.getByRole('columnheader', { name: '曲名', exact: true }).click();
}
async function expectQueue(page: Page): Promise<void> {
  await expect(panel(page).getByRole('heading', { name: '播放队列', exact: true })).toBeVisible();
  await expect(queue(page)).toHaveAttribute('aria-expanded', 'true');
}
async function pinQueue(page: Page): Promise<void> {
  await queue(page).click(); await expectQueue(page);
  await page.getByRole('button', { name: '固定播放队列', exact: true }).click();
  await expect(queue(page)).toHaveAttribute('aria-pressed', 'true');
}
async function play(page: Page): Promise<void> {
  await page.getByRole('button', { name: '播放 Alpha.wav', exact: true }).click(); await waitPlaying(page);
}

test('queue is temporary by default and pinning preserves its preference across hide and unpin actions', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await expect(panel(page)).toHaveCount(0);
  expect(await queue(page).getAttribute('aria-pressed')).toBeNull();
  await queue(page).click(); await expectQueue(page);
  await outside(page); await expect(panel(page)).toHaveCount(0);
  await pinQueue(page); await outside(page); await expectQueue(page);
  await expect.poll(() => preferences(page)).toMatchObject({ queuePinned: true });
  for (const hide of ['toggle', 'close', 'escape']) {
    if (hide === 'toggle') await queue(page).click();
    else if (hide === 'close') await close(page).click();
    else await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(queue(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(queue(page)).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => preferences(page)).toMatchObject({ queuePinned: true });
    await queue(page).click(); await expectQueue(page);
  }
  await page.getByRole('button', { name: '取消固定播放队列', exact: true }).click();
  await expectQueue(page);
  expect(await queue(page).getAttribute('aria-pressed')).toBeNull();
  await expect.poll(() => preferences(page)).toMatchObject({ queuePinned: false });
  await outside(page); await expect(panel(page)).toHaveCount(0);
  expect(creates).toEqual([]); expect(errors).toEqual([]);
});

test('refresh restores a pinned empty queue without requiring a current track', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await pinQueue(page); await page.reload();
  await expectQueue(page);
  await expect(queue(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '取消固定播放队列', exact: true })).toBeVisible();
  await expect(panel(page)).toContainText('还没有加入曲目');
  await expect(page.locator('audio')).toHaveCount(0);
  await expect(lyrics(page)).toBeDisabled();
  await outside(page); await expectQueue(page);
  expect(creates).toEqual([]); expect(errors).toEqual([]);
});

test('refresh preserves appended queue entries including duplicates without starting playback', async ({ page }) => {
  const { creates, errors } = await setup(page, 3);
  const titles = ['Alpha.wav', 'Beta.wav', 'Track 3.wav'];
  await page.getByRole('button', { name: '加入队列', exact: true }).click();
  await page.getByRole('button', { name: '加入队列', exact: true }).click();
  await queue(page).click(); await expectQueue(page);
  await expect(page.locator('.queue-list button')).toHaveText([...titles, ...titles]);
  await page.reload();
  await expect(page.getByRole('button', { name: '账号菜单', exact: true })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await queue(page).click(); await expectQueue(page);
  await expect(page.locator('.queue-list button')).toHaveText([...titles, ...titles]);
  await expect(page.locator('.queue-list button[aria-current="true"]')).toHaveCount(0);
  await expect(page.locator('audio')).toHaveCount(0);
  expect(creates).toEqual([]); expect(errors).toEqual([]);
});

test('refresh restores shuffled pinned queue, selected entry and mode without resuming audio', async ({ page }) => {
  // 固定重排结果，同时保留重复曲目以验证恢复的是队列位置。
  await page.addInitScript(() => { Math.random = () => 0; });
  const { creates, errors } = await setup(page, 3);
  const original = ['Alpha.wav', 'Beta.wav', 'Track 3.wav', 'Alpha.wav', 'Beta.wav', 'Track 3.wav'];
  await page.getByRole('button', { name: '加入队列', exact: true }).click();
  await page.getByRole('button', { name: '加入队列', exact: true }).click();
  await pinQueue(page);
  const buttons = page.locator('.queue-list button');
  await buttons.nth(4).click(); await waitPlaying(page);
  await page.getByRole('button', { name: '播放模式：顺序播放，点击切换', exact: true }).click();
  await page.getByRole('button', { name: '打乱队列', exact: true }).click();
  await expect.poll(() => buttons.allTextContents()).not.toEqual(original);
  const shuffled = await buttons.allTextContents();
  expect([...shuffled].sort()).toEqual([...original].sort());
  const selectedIndex = await buttons.evaluateAll((items) => items.findIndex((item) => item.getAttribute('aria-current') === 'true'));
  expect(selectedIndex).toBeGreaterThanOrEqual(0);
  await expect(buttons.nth(selectedIndex)).toHaveText('Beta.wav');
  await page.reload();
  await expectQueue(page);
  await expect(queue(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(buttons).toHaveText(shuffled);
  await expect(buttons.nth(selectedIndex)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.queue-list button[aria-current="true"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '播放模式：列表循环，点击切换', exact: true })).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(0);
  expect(creates).toEqual(['Beta']);
  await buttons.nth(selectedIndex).click(); await waitPlaying(page);
  expect(creates).toEqual(['Beta', 'Beta']); expect(errors).toEqual([]);
});

test('temporary lyrics restores a visible pinned queue but respects an explicitly hidden queue', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await play(page); await pinQueue(page);
  await lyrics(page).click();
  await expect(panel(page).locator('.lyrics')).toHaveText('Alpha 第一行\nAlpha 第二行');
  await close(page).click(); await expectQueue(page);
  await queue(page).click(); await expect(panel(page)).toHaveCount(0);
  await lyrics(page).click();
  await expect(panel(page).getByRole('heading', { name: '歌词', exact: true })).toBeVisible();
  await close(page).click(); await expect(panel(page)).toHaveCount(0);
  await expect(queue(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => preferences(page)).toMatchObject({ queuePinned: true });
  expect(creates).toEqual(['Alpha']); expect(errors).toEqual([]);
});

test('pinned queue and lyrics can take turns in the panel without restarting playback', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await play(page); const audio = page.locator('audio'), original = await audio.elementHandle();
  const source = await audio.getAttribute('src');
  await pinQueue(page); await lyrics(page).click();
  await page.getByRole('button', { name: '固定歌词', exact: true }).click();
  await expect.poll(() => preferences(page)).toMatchObject({ queuePinned: true, lyricsPinned: true });
  for (let iteration = 0; iteration < 2; iteration++) {
    await queue(page).click(); await expectQueue(page);
    await expect(queue(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(lyrics(page)).toHaveAttribute('aria-pressed', 'false');
    await lyrics(page).click();
    await expect(panel(page).getByRole('heading', { name: '歌词', exact: true })).toBeVisible();
    await expect(lyrics(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(queue(page)).toHaveAttribute('aria-pressed', 'false');
  }
  await close(page).click(); await expectQueue(page);
  expect(await original!.evaluate((element) => element === document.querySelector('audio'))).toBe(true);
  expect(await audio.getAttribute('src')).toBe(source); expect(creates).toEqual(['Alpha']); expect(errors).toEqual([]);
});

async function tooltipGeometry(page: Page, info: TestInfo, label: string, input: 'mouse' | 'keyboard', name: string) {
  const button = page.getByRole('button', { name: label, exact: true });
  await page.mouse.move(0, 0);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  if (input === 'mouse') await button.hover();
  else { await button.focus(); await expect(button).toBeFocused(); }
  const tooltip = page.getByRole('tooltip', { name: label, exact: true });
  await expect(tooltip).toBeVisible();
  const geometry = await tooltip.evaluate((element) => {
    const box = element.getBoundingClientRect(), panel = document.querySelector('.player-panel')!;
    const ancestors = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) ancestors.push(parent.tagName);
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom,
      viewportWidth: document.documentElement.clientWidth, viewportHeight: document.documentElement.clientHeight,
      panelTop: panel.getBoundingClientRect().top, scrolls: panel.scrollHeight > panel.clientHeight,
      insidePanel: !!element.closest('.player-panel'), position: getComputedStyle(element).position,
      contentWidth: element.scrollWidth, width: element.clientWidth, ancestors };
  });
  expect(geometry.x).toBeGreaterThanOrEqual(7); expect(geometry.y).toBeGreaterThanOrEqual(7);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - 7);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight - 7);
  expect(geometry.y).toBeLessThan(geometry.panelTop); expect(geometry.scrolls).toBe(true);
  expect(geometry.insidePanel).toBe(false); expect(geometry.position).toBe('fixed');
  expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.ancestors).toEqual(['BODY', 'HTML']);
  await page.screenshot({ path: info.outputPath(`${name}-${input}.png`) });
  return { label, input, ...geometry };
}

for (const viewport of [{ width: 1200, height: 900 }, { width: 390, height: 844 }]) {
  test(`queue header order and unclipped pin tooltips fit at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const { creates, errors } = await setup(page, 30);
    await page.getByRole('button', { name: '加入队列', exact: true }).click();
    await queue(page).click(); await expectQueue(page);
    const title = await panel(page).getByRole('heading', { name: '播放队列', exact: true }).boundingBox();
    const shuffle = await page.getByRole('button', { name: '打乱队列', exact: true }).boundingBox();
    const pin = await page.getByRole('button', { name: '固定播放队列', exact: true }).boundingBox();
    const end = await close(page).boundingBox();
    expect(shuffle!.x).toBeGreaterThanOrEqual(title!.x + title!.width);
    expect(pin!.x).toBeGreaterThanOrEqual(shuffle!.x + shuffle!.width);
    expect(end!.x).toBeGreaterThanOrEqual(pin!.x + pin!.width);
    const centers = [title!, shuffle!, pin!, end!].map((box) => box.y + box.height / 2);
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(2);
    expect(await panel(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const evidence = [];
    for (const input of ['mouse', 'keyboard'] as const) evidence.push(await tooltipGeometry(page, info, '固定播放队列', input, `${viewport.width}-queue-pin`));
    await page.getByRole('button', { name: '固定播放队列', exact: true }).press('Enter');
    await expect(queue(page)).toHaveAttribute('aria-pressed', 'true');
    for (const input of ['mouse', 'keyboard'] as const) evidence.push(await tooltipGeometry(page, info, '取消固定播放队列', input, `${viewport.width}-queue-unpin`));
    for (const input of ['mouse', 'keyboard'] as const) evidence.push(await tooltipGeometry(page, info, '关闭面板', input, `${viewport.width}-queue-close`));
    await info.attach('queue-header-and-tooltip-geometry', { body: JSON.stringify({ viewport, title, shuffle, pin, close: end, evidence }, null, 2), contentType: 'application/json' });
    expect(creates).toEqual([]); expect(errors).toEqual([]);
  });
}
