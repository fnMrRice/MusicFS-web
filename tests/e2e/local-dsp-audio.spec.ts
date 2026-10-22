import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';

let server: ViteDevServer;
let origin: string;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, '../..'), configFile: false,
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'audio-render-test', configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url !== '/audio-render-test') { next(); return; }
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Local DSP rendering test</title>');
      });
    } }],
  });
  await server.listen();
  origin = server.resolvedUrls!.local[0];
});
test.afterAll(async () => { await server?.close(); });

test('native audio rendering validates gain, EQ, compression, reverb, bypass and final mute', async ({ page }) => {
  await page.goto(`${origin}audio-render-test`);
  const rendered = await page.evaluate(async () => {
    const graphModule = '/src/player/dsp/graph.ts'; const modelModule = '/src/player/dsp/model.ts';
    const { LocalDSPGraph } = await import(graphModule);
    const { createLocalDSPNode } = await import(modelModule);
    async function render(kind: string, params: Record<string, number>, enabled = true, muted = false, nodeEnabled = true) {
      const context = new OfflineAudioContext(2, 48000, 48000);
      const node = createLocalDSPNode(kind); Object.assign(node.params, params); node.enabled = nodeEnabled;
      const graph = new LocalDSPGraph(context, { enabled, chain: [node] });
      if (muted) graph.setVolume(0);
      const buffer = context.createBuffer(2, 48000, 48000);
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let sample = 0; sample < 24000; sample++) {
          const amplitude = kind === 'compressor' ? (sample < 12000 ? 0.025 : 0.5) : 0.25;
          data[sample] = amplitude * Math.sin(2 * Math.PI * 1000 * sample / 48000);
        }
      }
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(graph.input); source.start();
      const audio = (await context.startRendering()).getChannelData(0);
      const rms = (start: number, end: number) => Math.sqrt(audio.slice(start, end).reduce((sum, value) => sum + value * value, 0) / (end - start));
      const values = { signal: rms(12000, 20000), tail: rms(26000, 36000), dynamicRange: rms(16000, 20000) / rms(8000, 10000), finite: audio.every(Number.isFinite) };
      graph.dispose(); return values;
    }
    return {
      dry: await render('gain', { gain: 0 }),
      gain: await render('gain', { gain: -6 }),
      eq: await render('equalizer', { frequency: 1000, q: 1, gain: 12 }),
      compressor: await render('compressor', { threshold: -35, knee: 0, ratio: 20, attack: 0.001, release: 0.05 }),
      reverb: await render('reverb', { mix: 1, decay: 2, tone: 10000 }),
      bypass: await render('gain', { gain: -24 }, false),
      nodeBypass: await render('gain', { gain: -24 }, true, false, false),
      mute: await render('reverb', { mix: 0.8 }, true, true),
    };
  });
  expect(Object.values(rendered).every((value) => value.finite)).toBe(true);
  expect(rendered.gain.signal / rendered.dry.signal).toBeCloseTo(10 ** (-6 / 20), 3);
  expect(rendered.eq.signal / rendered.dry.signal).toBeCloseTo(10 ** (12 / 20), 2);
  // 原生压缩器包含补偿增益，因此验证输入 20 倍动态被压缩，而不只比较绝对响度。
  expect(rendered.compressor.dynamicRange).toBeLessThan(3);
  expect(rendered.reverb.tail).toBeGreaterThan(0.00001);
  expect(rendered.bypass.signal).toBeCloseTo(rendered.dry.signal, 5);
  expect(rendered.nodeBypass.signal).toBeCloseTo(rendered.dry.signal, 5);
  expect(rendered.mute.signal).toBeLessThan(1e-9);
  expect(rendered.mute.tail).toBeLessThan(1e-9);
});

test('six-channel compression retains channel positions and does not leak into silent channels', async ({ page }) => {
  await page.goto(`${origin}audio-render-test`);
  const levels = await page.evaluate(async () => {
    const graphModule = '/src/player/dsp/graph.ts'; const modelModule = '/src/player/dsp/model.ts';
    const { LocalDSPGraph } = await import(graphModule); const { createLocalDSPNode } = await import(modelModule);
    const context = new OfflineAudioContext(6, 24000, 48000);
    const node = createLocalDSPNode('compressor');
    node.params.ratio = 1;
    const graph = new LocalDSPGraph(context, { enabled: true, chain: [node] }, 6);
    const buffer = context.createBuffer(6, 24000, 48000);
    for (const channel of [2, 5]) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index++) data[index] = 0.1 * Math.sin(2 * Math.PI * (400 + 100 * channel) * index / 48000);
    }
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(graph.input); source.start();
    const output = await context.startRendering(); graph.dispose();
    return Array.from({ length: 6 }, (_, channel) => {
      const data = output.getChannelData(channel).slice(12000);
      return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    });
  });
  for (const channel of [2, 5]) expect(levels[channel]).toBeGreaterThan(0.04);
  for (const channel of [0, 1, 3, 4]) expect(levels[channel]).toBeLessThan(1e-9);
});

test('song fades render a linear envelope without overriding volume or pause', async ({ page }) => {
  await page.goto(`${origin}audio-render-test`);
  const rendered = await page.evaluate(async () => {
    const graphModule = '/src/player/dsp/graph.ts';
    const { LocalDSPGraph } = await import(graphModule);
    async function render(mode: 'out' | 'in' | 'muted' | 'paused') {
      const context = new OfflineAudioContext(1, 24000, 48000);
      const graph = new LocalDSPGraph(context, { enabled: true, chain: [] });
      graph.setVolume(mode === 'muted' ? 0 : 0.3);
      if (mode === 'paused') graph.setPaused(true);
      if (mode === 'out') graph.fadeTo(0, 300); else graph.fadeIn(300);
      const buffer = context.createBuffer(1, 24000, 48000);
      const data = buffer.getChannelData(0);
      for (let sample = 0; sample < data.length; sample++) data[sample] = 0.5 * Math.sin(2 * Math.PI * 1000 * sample / 48000);
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(graph.input); source.start();
      const audio = (await context.startRendering()).getChannelData(0); graph.dispose();
      return [0.01, 0.14, 0.28, 0.4].map((seconds) => {
        const values = audio.slice(Math.round(seconds * 48000), Math.round((seconds + 0.01) * 48000));
        return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
      });
    }
    return { out: await render('out'), in: await render('in'), muted: await render('muted'), paused: await render('paused') };
  });
  const fullVolume = 0.5 * 0.3 / Math.sqrt(2);
  expect(rendered.out[0]).toBeGreaterThan(rendered.out[1]);
  expect(rendered.out[1]).toBeGreaterThan(rendered.out[2]);
  expect(rendered.out[3]).toBeLessThan(1e-9);
  expect(rendered.in[0]).toBeLessThan(rendered.in[1]);
  expect(rendered.in[1]).toBeLessThan(rendered.in[2]);
  expect(rendered.in[3]).toBeCloseTo(fullVolume, 5);
  for (const value of [...rendered.muted, ...rendered.paused]) expect(value).toBeLessThan(1e-9);
});

test('a fade started after steady playback anchors its ramp at the current audio time', async ({ page }, info) => {
  await page.goto(`${origin}audio-render-test`);
  const rendered = await page.evaluate(async () => {
    const graphModule = '/src/player/dsp/graph.ts';
    const { LocalDSPGraph } = await import(graphModule);
    async function render(previousFade: boolean) {
      const context = new OfflineAudioContext(1, 67200, 48000);
      const graph = new LocalDSPGraph(context, { enabled: true, chain: [] }, 1);
      graph.setVolume(0.3);
      if (previousFade) graph.fadeIn(300);
      const buffer = context.createBuffer(1, 67200, 48000);
      const data = buffer.getChannelData(0);
      for (let sample = 0; sample < data.length; sample++) data[sample] = 0.5 * Math.sin(2 * Math.PI * 1000 * sample / 48000);
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(graph.input); source.start();
      // 真正先渲染稳定音频，再在后续音频时刻发起淡出，覆盖已完成包络留下旧事件的情况。
      const suspended = context.suspend(0.8);
      const completed = context.startRendering();
      await suspended;
      const startedAt = context.currentTime;
      graph.fadeTo(0, 300);
      await context.resume();
      const audio = (await completed).getChannelData(0); graph.dispose();
      const rms = (from: number, to: number) => {
        const values = audio.slice(Math.round(from * 48000), Math.round(to * 48000));
        return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
      };
      return {
        startedAt, before: rms(0.74, 0.76),
        early: rms(startedAt + 0.02, startedAt + 0.04),
        middle: rms(startedAt + 0.14, startedAt + 0.16),
        late: rms(startedAt + 0.27, startedAt + 0.29),
        after: rms(startedAt + 0.34, startedAt + 0.36),
      };
    }
    return { firstFade: await render(false), afterFadeIn: await render(true) };
  });
  await info.attach('late-fade-output-envelope', { body: JSON.stringify(rendered), contentType: 'application/json' });
  for (const values of Object.values(rendered)) {
    expect(values.before).toBeCloseTo(0.5 * 0.3 / Math.sqrt(2), 5);
    expect(values.early / values.before).toBeCloseTo(0.9, 2);
    expect(values.middle / values.before).toBeCloseTo(0.5, 2);
    expect(values.late / values.before).toBeGreaterThan(0.05);
    expect(values.late / values.before).toBeLessThan(0.08);
    expect(values.after).toBeLessThan(1e-9);
  }
});
