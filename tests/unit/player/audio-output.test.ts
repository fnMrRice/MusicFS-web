import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultAudioOutput, normalizeAudioOutput, supportedOutputChannels } from '../../../src/player/dsp/output';
import { outputMatrix } from '../../../src/player/dsp/output-matrix';
import { AudioOutputController } from '../../../src/player/dsp/output-controller';
import type { AudioOutputConfig } from '../../../src/player/dsp/output';
import type { LocalDSPGraph } from '../../../src/player/dsp/graph';

function fixture(maximum = 8) {
  const devices = new EventTarget();
  vi.stubGlobal('navigator', { mediaDevices: devices });
  const context = Object.assign(new EventTarget(), { destination: { maxChannelCount: maximum, channelCount: 2, channelInterpretation: 'speakers' } });
  const changed = vi.fn();
  const failed = vi.fn();
  const controller = new AudioOutputController(() => true, changed, failed);
  controller.bind(context as unknown as AudioContext);
  const graph = (channels = 2) => {
    const value = { channels, outputChannels: channels, setOutput: vi.fn((_config: AudioOutputConfig, count: number) => { value.outputChannels = count; }) };
    return value as unknown as LocalDSPGraph;
  };
  return { context, controller, devices, changed, graph, failed };
}
afterEach(() => vi.unstubAllGlobals());

describe('audio output configuration and matrices', () => {
  it('defaults to source without expansion and rejects malformed saved settings', () => {
    expect(defaultAudioOutput()).toEqual({ layout: 'source', expandStereo: false });
    for (const input of [null, [], { layout: '8', expandStereo: 1 }, { layout: { toString: () => 'stereo' } }]) {
      expect(normalizeAudioOutput(input)).toEqual(defaultAudioOutput());
    }
    expect(normalizeAudioOutput({ layout: '7.1', expandStereo: true, extra: 1 })).toEqual({ layout: '7.1', expandStereo: true });
    expect(supportedOutputChannels(8, 4)).toBe(2);
    expect(supportedOutputChannels(4, 8)).toBe(4);
  });

  it('keeps PCM ordering, merges back and side at equal level, and excludes LFE from stereo', () => {
    const surround = outputMatrix(8, 6, false);
    expect(surround[3].weights).toEqual([0, 0, 0, 1, 0, 0, 0, 0]);
    expect(surround[4].weights).toEqual([0, 0, 0, 0, .5, 0, .5, 0]);
    expect(surround[5].weights).toEqual([0, 0, 0, 0, 0, .5, 0, .5]);
    const stereo = outputMatrix(6, 2, false);
    expect(stereo[0].weights[1]).toBe(0);
    expect(stereo[0].weights[3]).toBe(0);
    expect(stereo[0].weights[2] / stereo[0].weights[0]).toBeCloseTo(Math.SQRT1_2);
    expect(stereo[0].weights[4]).toBe(stereo[0].weights[2]);
    expect(stereo[1].weights[5]).toBe(stereo[1].weights[2]);
    for (const input of [1, 2, 6, 8]) for (const output of [1, 2, 6, 8]) {
      for (const row of outputMatrix(input, output, false)) expect(row.weights.reduce((sum, value) => sum + Math.abs(value), 0)).toBeLessThanOrEqual(1.00000001);
    }
  });

  it('leaves padding silent unless stereo expansion is explicitly enabled', () => {
    expect(outputMatrix(2, 8, false).slice(2).every((row) => row.weights.every((weight) => weight === 0))).toBe(true);
    const expanded = outputMatrix(2, 8, true);
    expect(expanded[2].weights).toEqual([.5, .5]);
    expect(expanded[3]).toMatchObject({ weights: [.25, .25], filter: 'lowpass' });
    expect(expanded[4]).toMatchObject({ weights: [.35, -.35], filter: 'highpass', delay: .027 });
    expect(expanded[6]).toMatchObject({ weights: [.5, -.5], filter: 'highpass', delay: .015 });
    expect(outputMatrix(7, 6, true).every((row, index) => row.weights[index] === 1 && row.weights.filter(Boolean).length === 1)).toBe(true);
  });
});

describe('audio output capabilities and live device changes', () => {
  it('probes without changing hardware count and preserves the preference through device downgrade and upgrade', () => {
    const { controller, context, graph, devices, changed } = fixture(2);
    controller.setConfig({ layout: '7.1', expandStereo: true });
    expect(controller.inspect()).toMatchObject({ maxChannels: 2, sourceChannels: null, outputChannels: null, limited: true });
    expect(context.destination.channelCount).toBe(2);
    const active = graph(); controller.add(active);
    expect(controller.inspect()).toMatchObject({ sourceChannels: 2, outputChannels: 2, limited: true });
    context.destination.maxChannelCount = 8;
    devices.dispatchEvent(new Event('devicechange'));
    expect(controller.inspect()).toMatchObject({ outputChannels: 8, limited: false });
    expect(active.setOutput).toHaveBeenLastCalledWith({ layout: '7.1', expandStereo: true }, 8);
    context.destination.maxChannelCount = 2;
    context.dispatchEvent(new Event('sinkchange'));
    expect(controller.inspect()).toMatchObject({ outputChannels: 2, limited: true });
    controller.remove(active);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ sourceChannels: null, outputChannels: null }));
    controller.dispose();
    const reports = changed.mock.calls.length;
    devices.dispatchEvent(new Event('devicechange'));
    expect(changed).toHaveBeenCalledTimes(reports);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ maxChannels: null, sourceChannels: null, outputChannels: null }));
  });

  it('uses the existing safe count when capability access or hardware configuration fails', () => {
    const { controller, context, graph } = fixture();
    Object.defineProperty(context.destination, 'maxChannelCount', { get: () => { throw new Error('Device unavailable'); }, configurable: true });
    controller.setConfig({ layout: '7.1', expandStereo: false });
    controller.add(graph(6));
    expect(controller.inspect()).toMatchObject({ maxChannels: null, outputChannels: 2, limited: true });
    Object.defineProperty(context.destination, 'maxChannelCount', { value: 8 });
    Object.defineProperty(context.destination, 'channelCount', { get: () => 2, set: () => { throw new Error('Unsupported hardware configuration'); } });
    expect(() => controller.inspect()).not.toThrow();
    expect(controller.inspect()).toMatchObject({ maxChannels: 8, outputChannels: 2, limited: true });
    controller.dispose();
  });

  it('preserves source count including nonstandard discrete layouts and deduplicates status', () => {
    const { controller, graph, changed } = fixture();
    const active = graph(7); controller.add(active);
    expect(controller.inspect()).toMatchObject({ sourceChannels: 7, outputChannels: 7, limited: false });
    const reports = changed.mock.calls.length;
    controller.inspect(); controller.setConfig(defaultAudioOutput());
    expect(changed).toHaveBeenCalledTimes(reports);
    controller.dispose();
  });

  it('contains routing failures during device events, restores hardware configuration, and clears only its own error on retry', () => {
    const { controller, context, graph, failed, devices } = fixture();
    const active = graph(6); controller.add(active);
    vi.mocked(active.setOutput).mockImplementationOnce(() => { throw new Error('Node allocation failed'); });
    controller.setConfig({ layout: 'stereo', expandStereo: false });
    expect(failed).toHaveBeenLastCalledWith(true);
    expect(active.outputChannels).toBe(6);
    expect(context.destination.channelCount).toBe(6);
    vi.mocked(active.setOutput).mockImplementationOnce(() => { throw new Error('Node allocation failed'); });
    expect(() => devices.dispatchEvent(new Event('devicechange'))).not.toThrow();
    expect(failed).toHaveBeenLastCalledWith(true);
    expect(controller.inspect()).toMatchObject({ outputChannels: 2, limited: false });
    expect(failed).toHaveBeenLastCalledWith(false);
    controller.dispose();
  });
});
