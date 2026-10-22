import { expect, test, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { playback, track } from '../fixtures/dto';
import { installAudioProbe, outputSignal } from '../fixtures/audio-probe';
import { waitPlaying } from './helpers';

let server: PreviewServer;
let origin: string;
const preferenceKey = 'musicfs:volume-controls:listener:preferences';
test.beforeAll(async () => {
  server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Preview address unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

function tone(): Buffer {
  const rate = 8000, frames = rate * 30, bytes = frames * 2;
  const data = Buffer.alloc(44 + bytes);
  data.write('RIFF', 0); data.writeUInt32LE(36 + bytes, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40);
  for (let frame = 0; frame < frames; frame++) data.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 440 * frame / rate)), 44 + frame * 2);
  return data;
}

async function setup(page: Page) {
  const creates: string[] = [], errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioProbe(page);
  const sound = tone();
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) return route.fulfill({ contentType: 'audio/wav', body: sound });
    if (request.method() === 'DELETE') return route.fulfill({ status: 204 });
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: '1' };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', ready: true, apiVersion: '1', instanceId: 'volume-controls' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'fixture', user: { id: 'listener', role: 'user' } };
    if (path.endsWith('/source-tracks')) json = { items: [{ ...track, displayName: 'Volume.wav' }], nextCursor: null, libraryRevision: '1' };
    if (path.endsWith('/playback/sessions') && request.method() === 'POST') {
      creates.push(request.postDataJSON().sourceTrackId);
      json = playback(`attempt-${creates.length}`);
    }
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/library`);
  await expect(page.getByRole('button', { name: '账号菜单', exact: true })).toBeVisible();
  return { creates, errors };
}

const slider = (page: Page) => page.getByRole('slider', { name: '音量', exact: true });
const mute = (page: Page) => page.getByRole('button', { name: '静音', exact: true });
const unmute = (page: Page) => page.getByRole('button', { name: '取消静音', exact: true });
const volumeValue = (page: Page) => slider(page).locator('..').locator('.volume-value');
const preferences = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), preferenceKey);
async function percentage(page: Page, expected: string): Promise<void> {
  await slider(page).focus();
  await expect(slider(page)).toHaveAttribute('aria-valuetext', expected);
  await expect(volumeValue(page)).toBeVisible();
  await expect(volumeValue(page)).toHaveText(expected);
}

test('volume defaults to 80 percent, updates real output without restarting and survives refresh', async ({ page }, info) => {
  const { creates, errors } = await setup(page);
  expect(await page.evaluate((key) => localStorage.getItem(key), preferenceKey)).toBeNull();
  await expect(slider(page)).toHaveValue('0.8');
  await expect(volumeValue(page)).toBeHidden();
  await slider(page).hover();
  await expect(volumeValue(page)).toBeVisible();
  await percentage(page, '80%');
  await expect(mute(page)).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '播放 Volume.wav', exact: true }).click(); await waitPlaying(page);
  const audio = page.locator('audio'), original = await audio.elementHandle();
  const src = await audio.getAttribute('src'), baseline = await outputSignal(page);
  expect(baseline.rms).toBeGreaterThan(0.01);
  await slider(page).fill('0.37'); await percentage(page, '37%');
  await expect.poll(async () => (await outputSignal(page)).rms / baseline.rms).toBeCloseTo(0.37 / 0.8, 2);
  await expect.poll(() => preferences(page)).toMatchObject({ volume: 0.37, lastVolume: 0.37 });
  await page.screenshot({ path: info.outputPath('volume-percent.png') });
  await mute(page).click();
  await expect.poll(async () => (await outputSignal(page)).rms).toBeLessThan(0.00001);
  await unmute(page).click();
  await expect.poll(async () => (await outputSignal(page)).rms / baseline.rms).toBeCloseTo(0.37 / 0.8, 2);
  expect(await original!.evaluate((element) => element === document.querySelector('audio'))).toBe(true);
  expect(await audio.getAttribute('src')).toBe(src); expect(creates).toHaveLength(1);
  await page.reload();
  await expect(slider(page)).toHaveValue('0.37'); await percentage(page, '37%');
  await expect(page.locator('audio')).toHaveCount(0);
  expect(creates).toHaveLength(1); expect(errors).toEqual([]);
});

test('mute changes its icon and persists silence while remembering the previous volume', async ({ page }, info) => {
  const { errors } = await setup(page);
  await slider(page).fill('0.37');
  const audibleIcon = await mute(page).locator('svg').innerHTML();
  await mute(page).click();
  await expect(unmute(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(slider(page)).toHaveValue('0'); await percentage(page, '0%');
  const mutedIcon = await unmute(page).locator('svg').innerHTML();
  expect(mutedIcon).not.toBe(audibleIcon);
  await expect.poll(() => preferences(page)).toMatchObject({ volume: 0, lastVolume: 0.37 });
  await page.screenshot({ path: info.outputPath('volume-muted.png') });
  await page.reload();
  await expect(unmute(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(slider(page)).toHaveValue('0');
  expect(await unmute(page).locator('svg').innerHTML()).toBe(mutedIcon);
  await unmute(page).click();
  await expect(slider(page)).toHaveValue('0.37');
  await expect(mute(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await mute(page).locator('svg').innerHTML()).toBe(audibleIcon);
  await expect.poll(() => preferences(page)).toMatchObject({ volume: 0.37, lastVolume: 0.37 });
  expect(errors).toEqual([]);
});

test('moving the slider to zero uses the muted state and restores the last positive selection', async ({ page }) => {
  const { creates, errors } = await setup(page);
  await slider(page).fill('0'); await percentage(page, '0%');
  await expect(unmute(page)).toHaveAttribute('aria-pressed', 'true');
  await unmute(page).click(); await expect(slider(page)).toHaveValue('0.8');
  await slider(page).fill('0.52'); await slider(page).fill('0');
  await expect.poll(() => preferences(page)).toMatchObject({ volume: 0, lastVolume: 0.52 });
  await page.reload();
  await expect(unmute(page)).toHaveAttribute('aria-pressed', 'true');
  await unmute(page).click(); await expect(slider(page)).toHaveValue('0.52');
  await percentage(page, '52%');
  await slider(page).press('ArrowRight'); await percentage(page, '53%');
  await expect.poll(() => preferences(page)).toMatchObject({ volume: 0.53, lastVolume: 0.53 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '播放配置', exact: true }).click();
  const settingsVolume = page.getByRole('slider', { name: '默认音量', exact: true });
  await expect(settingsVolume).toHaveValue('0.53');
  await settingsVolume.fill('0.29'); await settingsVolume.focus();
  await expect(settingsVolume).toHaveAttribute('aria-valuetext', '29%');
  await expect(settingsVolume.locator('..').locator('.volume-value')).toBeVisible();
  await expect(settingsVolume.locator('..').locator('.volume-value')).toHaveText('29%');
  await expect(slider(page)).toHaveValue('0.29');
  await expect.poll(() => preferences(page)).toMatchObject({ volume: 0.29, lastVolume: 0.29 });
  expect(creates).toEqual([]); expect(errors).toEqual([]);
});
