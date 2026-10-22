import { test, expect, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { playback, track } from '../fixtures/dto';
import { installAudioProbe, outputSignal } from '../fixtures/audio-probe';
import { waitPlaying } from './helpers';

let server: PreviewServer;
const origin = 'http://127.0.0.1:18161';
test.beforeAll(async () => { server = await preview({ preview: { host: '127.0.0.1', port: 18161, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); });

function tone(antiphase = false): Buffer {
  const channels = antiphase ? 2 : 1;
  const rate = 48000, frames = rate * 60, dataBytes = frames * 2 * channels;
  const data = Buffer.alloc(44 + dataBytes);
  data.write('RIFF', 0); data.writeUInt32LE(36 + dataBytes, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(channels, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2 * channels, 28);
  data.writeUInt16LE(2 * channels, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    const amplitude = antiphase ? (channel === 0 ? 0.8 : -0.7) : 0.2;
    data.writeInt16LE(Math.round(32767 * amplitude * Math.sin(2 * Math.PI * 440 * frame / rate)), 44 + (frame * channels + channel) * 2);
  }
  return data;
}

async function setup(page: Page, antiphase = false) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioProbe(page);
  const creates: { preferences: unknown }[] = [];
  const controls: string[] = [];
  const sound = tone(antiphase);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) return route.fulfill({ contentType: 'audio/wav', body: sound });
    if (path.includes('/dsp/settings') || path.endsWith('/seek') || path.endsWith('/recover')) controls.push(path);
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: '1' };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', ready: true, apiVersion: '1', instanceId: 'live-dsp' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'fixture', user: { id: 'listener', role: 'user' } };
    if (path.endsWith('/source-tracks')) json = { items: [{ ...track, displayName: 'tone.wav', durationMs: 60000 }], nextCursor: null, libraryRevision: '1' };
    if (path.endsWith('/playback/sessions') && request.method() === 'POST') {
      creates.push(request.postDataJSON());
      json = { ...playback(), outputProfile: { ...playback().outputProfile, channels: antiphase ? 2 : 1 }, seekableRange: { startMs: 0, endMs: 60000 } };
    }
    if (request.method() === 'DELETE') return route.fulfill({ status: 204 });
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/library`);
  await page.getByRole('button', { name: '播放 tone.wav', exact: true }).click();
  await waitPlaying(page);
  return { creates, controls, errors };
}

test('real browser output changes live without replacing the stream or requesting server effects', async ({ page }, info) => {
  const { creates, controls, errors } = await setup(page);
  await expect(page.locator('.player-status')).toHaveText('PCM → PCM · 1 声道');
  const audio = page.locator('audio');
  const original = await audio.elementHandle();
  const url = await audio.getAttribute('src');
  const baseline = await outputSignal(page);
  expect(baseline.rms).toBeGreaterThan(0.05);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: 'DSP 配置', exact: true }).click();
  await page.getByRole('button', { name: '添加效果', exact: true }).click();
  await page.getByRole('slider', { name: '调节 增益（dB）', exact: true }).fill('-12');
  await expect.poll(async () => (await outputSignal(page)).rms / baseline.rms).toBeLessThan(0.28);
  const attenuated = await outputSignal(page);
  expect(attenuated.rms / baseline.rms).toBeGreaterThan(0.23);
  await page.getByRole('checkbox', { name: '启用 增益', exact: true }).uncheck();
  await expect.poll(async () => (await outputSignal(page)).rms / baseline.rms).toBeGreaterThan(0.95);
  await page.getByRole('checkbox', { name: '启用 增益', exact: true }).check();
  await page.getByRole('checkbox', { name: '启用本地音效', exact: true }).uncheck();
  await expect.poll(async () => (await outputSignal(page)).rms / baseline.rms).toBeGreaterThan(0.95);
  await page.getByRole('checkbox', { name: '启用本地音效', exact: true }).check();
  await page.getByLabel('选择效果', { exact: true }).selectOption('reverb');
  await page.getByRole('button', { name: '添加效果', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.locator('.player-status')).toHaveText('PCM → PCM · 1 声道 · 本地音效');
  await expect.poll(async () => (await outputSignal(page)).rms).toBeLessThan(0.00001);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await waitPlaying(page);
  await expect.poll(async () => (await outputSignal(page)).rms).toBeGreaterThan(0.005);
  await page.getByRole('slider', { name: '曲目进度', exact: true }).fill('20000');
  await page.getByRole('slider', { name: '曲目进度', exact: true }).dispatchEvent('pointerup');
  await waitPlaying(page);
  await expect.poll(async () => (await outputSignal(page)).rms).toBeGreaterThan(0.005);
  await page.getByRole('slider', { name: '音量', exact: true }).fill('0');
  await expect.poll(async () => (await outputSignal(page)).rms).toBeLessThan(0.00001);
  expect(await original!.evaluate((element) => element === document.querySelector('audio'))).toBe(true);
  expect(await audio.getAttribute('src')).toBe(url);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(1);
  expect(creates).toHaveLength(1);
  expect(creates[0].preferences).toEqual({ forceProcessing: false, gainDb: 0, dspExecution: 'client' });
  expect(controls).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach('local-dsp-output', { body: JSON.stringify({ baseline, attenuated, ratio: attenuated.rms / baseline.rms, physicalListening: 'Not performed' }), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('local-dsp-live.png') });
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(audio).toHaveCount(0);
});

test('automatic volume balances real output live and preserves pause, mute and the current stream', async ({ page }, info) => {
  const { creates, controls, errors } = await setup(page);
  const audio = await page.locator('audio').elementHandle();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: 'DSP 配置', exact: true }).click();
  await page.getByRole('button', { name: '添加效果', exact: true }).click();
  await page.getByRole('slider', { name: '调节 增益（dB）', exact: true }).fill('12');
  const loud = await outputSignal(page);
  expect(loud.rms).toBeGreaterThan(0.4);
  await page.getByRole('tab', { name: '播放配置', exact: true }).click();
  await page.getByLabel('自动音量平衡', { exact: true }).check();
  await expect.poll(async () => (await outputSignal(page)).rms).toBeLessThan(0.12);
  const balanced = await outputSignal(page);
  expect(balanced.rms).toBeGreaterThan(0.09);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(async () => (await outputSignal(page)).rms).toBeLessThan(0.00001);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await waitPlaying(page);
  await expect.poll(async () => (await outputSignal(page)).rms).toBeGreaterThan(0.09);
  await page.getByRole('slider', { name: '音量', exact: true }).fill('0');
  await expect.poll(async () => (await outputSignal(page)).rms).toBeLessThan(0.00001);
  await page.getByLabel('自动音量平衡', { exact: true }).uncheck();
  await expect.poll(async () => (await outputSignal(page)).rms).toBeLessThan(0.00001);
  await page.getByRole('slider', { name: '音量', exact: true }).fill('0.8');
  await expect.poll(async () => (await outputSignal(page)).rms / loud.rms).toBeGreaterThan(0.95);
  expect(await audio!.evaluate((element) => element === document.querySelector('audio'))).toBe(true);
  expect(creates).toHaveLength(1);
  expect(controls).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach('automatic-volume-output', { body: JSON.stringify({ loud, balanced, physicalListening: 'Not performed' }), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('automatic-volume-live.png') });
  await page.getByRole('button', { name: '停止', exact: true }).click();
});

test('automatic volume measures stereo channels before phase cancellation', async ({ page }) => {
  await setup(page, true);
  const baseline = await outputSignal(page);
  expect(baseline.rms).toBeGreaterThan(0.02);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '播放配置', exact: true }).click();
  await page.getByLabel('自动音量平衡', { exact: true }).check();
  // 最终探针是单声道，因此用同一信号的前后比值验证反相信号仍被正确降低。
  await expect.poll(async () => (await outputSignal(page)).rms / baseline.rms).toBeLessThan(0.3);
  expect((await outputSignal(page)).rms / baseline.rms).toBeGreaterThan(0.2);
  await page.getByRole('button', { name: '停止', exact: true }).click();
});
