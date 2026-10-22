import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';

let server: ViteDevServer;
let origin: string;
test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, '../..'), configFile: false,
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'audio-output-test', configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url !== '/audio-output-test') { next(); return; }
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Audio output rendering test</title>');
      });
    } }],
  });
  await server.listen(); origin = server.resolvedUrls!.local[0];
});
test.afterAll(async () => { await server?.close(); });

test('native output matrix preserves channel positions and safely downmixes correlated surround input', async ({ page }, testInfo) => {
  await page.goto(`${origin}audio-output-test`);
  const result = await page.evaluate(async () => {
    const path = '/src/player/dsp/output-routing.ts';
    const { AudioOutputRouting } = await import(path);
    async function render(inputs: number, outputs: number, correlated = false) {
      const context = new OfflineAudioContext(outputs, 8192, 48000);
      context.destination.channelInterpretation = 'discrete';
      const route = new AudioOutputRouting(context, inputs, outputs, false);
      route.output.connect(context.destination);
      const buffer = context.createBuffer(inputs, 8192, 48000);
      for (let channel = 0; channel < inputs; channel++) {
        const data = buffer.getChannelData(channel);
        if (correlated) data.fill(.9);
        else data[256 + channel * 256] = 1;
      }
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(route.input); source.start();
      const rendered = await context.startRendering();
      const response = Array.from({ length: outputs }, (_, channel) => {
        const data = rendered.getChannelData(channel);
        return correlated ? Math.max(...data.map(Math.abs)) : Array.from({ length: inputs }, (_, input) => data[256 + input * 256]);
      });
      route.dispose(); return response;
    }
    return {
      surround: await render(8, 6), stereo: await render(6, 2), mono: await render(2, 1),
      center: await render(1, 6), padding: await render(2, 8), upmix: await render(6, 8),
      nonstandard: await render(7, 6), headroom: await render(8, 2, true),
    };
  });
  await testInfo.attach('rendered-output-matrices', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.surround).toEqual([
    [1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, .5, 0, .5, 0], [0, 0, 0, 0, 0, .5, 0, .5],
  ]);
  expect(result.mono).toEqual([[.5, .5]]);
  expect(result.center).toEqual([[0], [0], [1], [0], [0], [0]]);
  expect(result.padding).toEqual([[1, 0], [0, 1], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
  const stereo = result.stereo as number[][];
  expect(stereo[0][0]).toBeCloseTo(1 / (1 + Math.SQRT2), 6);
  expect(stereo[0][2]).toBeCloseTo(Math.SQRT1_2 / (1 + Math.SQRT2), 6);
  expect(stereo[0][4]).toBe(stereo[0][2]);
  expect(stereo[1][5]).toBe(stereo[0][2]);
  expect(stereo[0][3]).toBe(0); expect(stereo[1][3]).toBe(0);
  expect(result.upmix.slice(0, 6)).toEqual(Array.from({ length: 6 }, (_, output) => Array.from({ length: 6 }, (_, input) => input === output ? 1 : 0)));
  expect(result.upmix.slice(6)).toEqual([Array(6).fill(0), Array(6).fill(0)]);
  expect(result.nonstandard).toEqual(Array.from({ length: 6 }, (_, output) => Array.from({ length: 7 }, (_, input) => input === output ? 1 : 0)));
  for (const peak of result.headroom as number[]) expect(peak).toBeCloseTo(.9, 6);
});

test('native stereo expansion derives filtered bass and delayed surrounds while preserving fronts', async ({ page }, testInfo) => {
  await page.goto(`${origin}audio-output-test`);
  const result = await page.evaluate(async () => {
    const path = '/src/player/dsp/output-routing.ts';
    const { AudioOutputRouting } = await import(path);
    async function render(expand: boolean) {
      const rate = 48000, length = 24000;
      const context = new OfflineAudioContext(8, length, rate);
      context.destination.channelInterpretation = 'discrete';
      const route = new AudioOutputRouting(context, 2, 8, expand); route.output.connect(context.destination);
      const buffer = context.createBuffer(2, length, rate);
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let index = 0; index < length; index++) {
          const phase = 2 * Math.PI * index / rate;
          data[index] = .3 * Math.sin(phase * 60) + .2 * Math.sin(phase * 1000) + (channel ? -.1 : .1) * Math.sin(phase * 2000);
        }
      }
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(route.input); source.start();
      const rendered = await context.startRendering();
      const values = Array.from({ length: 8 }, (_, channel) => {
        const data = rendered.getChannelData(channel);
        const amplitude = (frequency: number) => {
          let real = 0, imaginary = 0;
          for (let index = 9600; index < 19200; index++) {
            real += data[index] * Math.cos(2 * Math.PI * frequency * index / rate);
            imaginary += data[index] * Math.sin(2 * Math.PI * frequency * index / rate);
          }
          return Math.hypot(real, imaginary) / 4800;
        };
        return { low: amplitude(60), middle: amplitude(1000), difference: amplitude(2000), peak: Math.max(...data.map(Math.abs)) };
      });
      route.dispose(); return values;
    }
    return { plain: await render(false), expanded: await render(true) };
  });
  await testInfo.attach('expanded-output-spectrum', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.expanded.slice(0, 2)).toEqual(result.plain.slice(0, 2));
  expect(result.plain.slice(2).every((channel) => channel.peak === 0)).toBe(true);
  expect(result.expanded[2].low).toBeCloseTo(.3, 4);
  expect(result.expanded[2].difference).toBeLessThan(.00001);
  expect(result.expanded[3].low).toBeGreaterThan(.14);
  expect(result.expanded[3].low).toBeLessThan(.151);
  expect(result.expanded[3].middle).toBeLessThan(.002);
  for (const channel of [4, 5, 6, 7]) {
    expect(result.expanded[channel].low).toBeLessThan(.00001);
    expect(result.expanded[channel].difference).toBeCloseTo(channel < 6 ? .07 : .1, 3);
  }
  expect(result.expanded.every((channel) => channel.peak < 1)).toBe(true);
});

test('live graph output changes work with effects bypassed and preserve final mute without replacing the source', async ({ page }, testInfo) => {
  await page.goto(`${origin}audio-output-test`);
  const result = await page.evaluate(async () => {
    const graphPath = '/src/player/dsp/graph.ts', modelPath = '/src/player/dsp/model.ts';
    const { LocalDSPGraph } = await import(graphPath); const { createLocalDSPNode } = await import(modelPath);
    const context = new OfflineAudioContext(6, 48000, 48000);
    context.destination.channelInterpretation = 'discrete';
    const effect = createLocalDSPNode('gain'); effect.params.gain = 12;
    const graph = new LocalDSPGraph(context, { enabled: false, chain: [effect] }, 2);
    const buffer = context.createBuffer(2, 48000, 48000);
    for (let channel = 0; channel < 2; channel++) buffer.getChannelData(channel).fill(.2);
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(graph.input); source.start();
    const initialInput = graph.input;
    const first = context.suspend(.125).then(() => {
      graph.setOutput({ layout: '5.1', expandStereo: true }, 6); return context.resume();
    });
    const second = context.suspend(.375).then(() => {
      graph.setVolume(0); graph.setOutput({ layout: 'stereo', expandStereo: false }, 2); return context.resume();
    });
    const third = context.suspend(.625).then(() => {
      graph.setOutput({ layout: '5.1', expandStereo: true }, 6); return context.resume();
    });
    const audio = await context.startRendering(); await Promise.all([first, second, third]);
    const at = (channel: number, seconds: number) => audio.getChannelData(channel)[Math.floor(seconds * 48000)];
    const values = { inputPreserved: graph.input === initialInput, initial: [at(0, .1), at(2, .1)], expanded: [at(0, .3), at(2, .3)], muted: [at(0, .8), at(2, .8)] };
    graph.dispose(); return values;
  });
  await testInfo.attach('live-output-samples', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.inputPreserved).toBe(true);
  expect(result.initial[0]).toBeCloseTo(.2, 6); expect(result.initial[1]).toBe(0);
  expect(result.expanded[0]).toBeCloseTo(.2, 6); expect(result.expanded[1]).toBeCloseTo(.2, 6);
  expect(result.muted).toEqual([0, 0]);
});
