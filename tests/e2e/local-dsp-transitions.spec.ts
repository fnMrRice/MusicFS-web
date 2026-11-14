import { musicPage } from "../fixtures/music-catalog";
import { routeApi } from "../fixtures/control-mock";
import { test, expect, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { playback, track } from '../fixtures/dto';
import { installAudioProbe, outputSignal } from '../fixtures/audio-probe';
import { logout, waitPlaying } from './helpers';

let server: PreviewServer;
const origin = 'http://127.0.0.1:18163';
const duration = 1200;
test.beforeAll(async () => { server = await preview({ preview: { host: '127.0.0.1', port: 18163, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); });

interface Sample { at: number; rms: number; src: string }
interface Event { at: number; type: string; label?: string; src?: string }
interface Recording { samples: Sample[]; events: Event[]; timer: number }
interface ProbeWindow extends Window {
  musicfsAudioProbe?: { analyser: AnalyserNode; context: AudioContext };
  musicfsTransitionRecording: Recording;
}

function tone(frequency: number): Buffer {
  const rate = 48000, frames = rate * 30, dataBytes = frames * 2;
  const data = Buffer.alloc(44 + dataBytes);
  data.write('RIFF', 0); data.writeUInt32LE(36 + dataBytes, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame++) data.writeInt16LE(Math.round(6553 * Math.sin(2 * Math.PI * frequency * frame / rate)), 44 + frame * 2);
  return data;
}

async function recordOutput(page: Page): Promise<void> {
  await installAudioProbe(page);
  await page.addInitScript(() => {
    const scope = window as unknown as ProbeWindow;
    const recording: Recording = { samples: [], events: [], timer: 0 };
    scope.musicfsTransitionRecording = recording;
    const buffer = new Float32Array(2048);
    // 直接采样共享探针的最终输出，保留时间序列，避免峰值汇总掩盖淡出淡入包络。
    recording.timer = window.setInterval(() => {
      const probe = scope.musicfsAudioProbe;
      if (!probe) return;
      probe.analyser.getFloatTimeDomainData(buffer);
      const rms = Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length);
      recording.samples.push({ at: performance.now(), rms, src: document.querySelector('audio')?.currentSrc ?? '' });
    }, 20);
    document.addEventListener('playing', (event) => {
      if (event.target instanceof HTMLMediaElement) recording.events.push({ type: 'playing', at: performance.now(), src: event.target.currentSrc });
    }, true);
    document.addEventListener('click', (event) => {
      const button = (event.target as Element).closest('button');
      if (button) recording.events.push({ type: 'click', at: performance.now(), label: button.getAttribute('aria-label') ?? button.textContent ?? '' });
    }, true);
  });
}

function meanRms(samples: Sample[], at: number, from: number, to: number, attempt: string): number {
  const selected = samples.filter((sample) => sample.src.includes(`/${attempt}/`) && sample.at >= at + from && sample.at <= at + to);
  expect(selected.length, `Audio samples in ${attempt} interval ${from}-${to} ms`).toBeGreaterThan(1);
  return selected.reduce((sum, sample) => sum + sample.rms, 0) / selected.length;
}

test('switching waits for audible fade-out, fades in after delayed playing and logout cancels a pending switch', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await recordOutput(page);
  const creates: unknown[] = [];
  let evidenceAttached = false;
  let baseline = 0;
  const sounds = [tone(440), tone(880)];
  let secondStreamRequested = false;
  let releaseSecondStream!: () => void;
  const secondStream = new Promise<void>((resolve) => { releaseSecondStream = resolve; });
  await routeApi(page, async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) {
      const second = path.includes('/attempt-2/');
      if (second) { secondStreamRequested = true; await secondStream; }
      return route.fulfill({ contentType: 'audio/wav', body: sounds[second ? 1 : 0] });
    }
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: '1' };
    if (path.endsWith('/health/ready')) json = { product: 'MusicFS', ready: true, apiVersion: '1', instanceId: 'transition-dsp' };
    if (path.endsWith('/auth/session')) json = { csrfToken: 'fixture', user: { id: 'listener', role: 'user' } };
    if (path.endsWith('/library/tracks')) json = musicPage([
      { ...track, displayName: 'tone-a.wav', durationMs: 30000 },
      { ...track, sourceTrackId: 'track-2', assetId: 'asset-2', displayName: 'tone-b.wav', durationMs: 30000 },
    ]);
    if (path.endsWith('/playback/sessions') && request.method() === 'POST') {
      await page.evaluate(() => {
        (window as unknown as ProbeWindow).musicfsTransitionRecording.events.push({ type: 'create', at: performance.now() });
      });
      creates.push(request.postDataJSON()); const count = creates.length;
      json = {
        ...playback(`attempt-${count}`), sessionId: `session-${count}`,
        streamUrl: `/api/v1/playback/sessions/session-${count}/attempts/attempt-${count}/stream`,
        outputProfile: { ...playback().outputProfile, channels: 1 },
      };
    }
    if (request.method() === 'DELETE') return route.fulfill({ status: 204 });
    return route.fulfill({ json });
  });
  try {
    await page.goto(`${origin}/#/library`);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '播放配置', exact: true }).click();
    await page.getByRole('checkbox', { name: '切歌淡出淡入', exact: true }).check();
    await page.getByLabel('淡出淡入时长（毫秒）', { exact: true }).fill(String(duration));
    await page.getByRole('checkbox', { name: '自动音量平衡', exact: true }).uncheck();
    await page.getByRole('button', { name: '展开作品库', exact: true }).click();
    await page.getByRole('link', { name: '曲目列表', exact: true }).click();
    await page.getByRole('button', { name: '播放 tone-a.wav', exact: true }).click();
    await waitPlaying(page);
    await expect.poll(async () => (await outputSignal(page)).rms).toBeGreaterThan(0.105);
    baseline = (await outputSignal(page)).rms;
    const original = await page.locator('audio').elementHandle();
    await page.evaluate(() => { const log = (window as unknown as ProbeWindow).musicfsTransitionRecording; log.samples = []; log.events = []; });

    await page.getByRole('button', { name: '播放 tone-b.wav', exact: true }).click();
    // 在淡出中段验证旧媒体仍存在，且尚未申请下一首会话。
    await page.waitForTimeout(350);
    expect(creates).toHaveLength(1);
    expect(await original!.evaluate((element) => element === document.querySelector('audio'))).toBe(true);
    await expect.poll(() => creates.length).toBe(2);
    await expect.poll(() => secondStreamRequested).toBe(true);
    await expect(page.locator('audio')).toHaveAttribute('src', /attempt-2/);
    // 比包络时长更久的加载停顿，确保淡入没有在实际 playing 前提前耗尽。
    await page.waitForTimeout(duration + 200);
    expect((await outputSignal(page)).rms).toBeLessThan(0.00001);
    releaseSecondStream();
    await waitPlaying(page);
    await page.waitForTimeout(duration + 300);
    const second = await outputSignal(page);
    expect(second.rms / baseline).toBeGreaterThan(0.95);
    expect(second.peakHz).toBeGreaterThan(800);

    await page.getByRole('button', { name: '播放 tone-a.wav', exact: true }).click();
    await page.waitForTimeout(250);
    await logout(page);
    await expect(page.locator('audio')).toHaveCount(0);
    await page.waitForTimeout(duration + 200);
    expect(creates).toHaveLength(2);
    // 注销还会关闭音频上下文；关闭后的分析器可能保留最后一帧，直接确认输出已释放。
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).musicfsAudioProbe?.context.state)).toBe('closed');

    const recording = await page.evaluate(() => {
      const log = (window as unknown as ProbeWindow).musicfsTransitionRecording;
      clearInterval(log.timer); return { samples: log.samples, events: log.events };
    });
    await info.attach('transition-output-envelope', {
      body: JSON.stringify({ baseline, ...recording, physicalListening: 'Not performed' }), contentType: 'application/json',
    });
    evidenceAttached = true;
    const click = recording.events.find((event) => event.type === 'click' && event.label === '播放 tone-b.wav')!;
    const create = recording.events.find((event) => event.type === 'create')!;
    const playing = recording.events.find((event) => event.type === 'playing' && event.src?.includes('/attempt-2/'))!;
    expect(create.at - click.at).toBeGreaterThanOrEqual(duration - 80);
    const fadingEarly = meanRms(recording.samples, click.at, 150, 300, 'attempt-1');
    const fadingLate = meanRms(recording.samples, click.at, 850, 1050, 'attempt-1');
    expect(fadingEarly).toBeGreaterThan(baseline * 0.65);
    expect(fadingLate).toBeLessThan(fadingEarly * 0.5);
    expect(fadingLate).toBeGreaterThan(baseline * 0.03);
    const risingEarly = meanRms(recording.samples, playing.at, 100, 250, 'attempt-2');
    const risingLate = meanRms(recording.samples, playing.at, 900, 1100, 'attempt-2');
    expect(risingEarly).toBeGreaterThan(baseline * 0.01);
    expect(risingEarly).toBeLessThan(risingLate * 0.45);
    expect(risingLate).toBeGreaterThan(baseline * 0.65);
    expect(errors).toEqual([]);
  } finally {
    releaseSecondStream();
    if (!evidenceAttached) {
      const recording = await page.evaluate(() => {
        const log = (window as unknown as ProbeWindow).musicfsTransitionRecording;
        if (!log) return null;
        clearInterval(log.timer); return { samples: log.samples, events: log.events };
      }).catch(() => null);
      if (recording) await info.attach('transition-output-envelope', {
        body: JSON.stringify({ baseline, ...recording, physicalListening: 'Not performed' }), contentType: 'application/json',
      });
    }
  }
});
