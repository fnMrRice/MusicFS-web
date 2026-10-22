import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoVolume } from '../../../src/player/dsp/auto-volume';

class Parameter {
  value = 1;
  cancelAndHoldAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  setTargetAtTime = vi.fn((value: number) => { this.value = value; });
}

class Analyser {
  fftSize = 0;
  smoothingTimeConstant = 1;
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
  samples: number[] = [0];
  connect = vi.fn();
  disconnect = vi.fn();
  getFloatTimeDomainData = vi.fn((target: Float32Array) => {
    target.forEach((_, index) => { target[index] = this.samples[index % this.samples.length]; });
  });
}

class Context {
  state = 'running';
  timeOffset = 0;
  get currentTime() { return Date.now() / 1000 + this.timeOffset; }
  analysers: Analyser[] = [];
  get input() { return this.analysers[0]; }
  get analyser() { return this.analysers[1]; }
  get probes() { return this.analysers.slice(1); }
  splitter = { connect: vi.fn(), disconnect: vi.fn() };
  output = { gain: new Parameter(), disconnect: vi.fn() };
  createAnalyser = () => {
    const analyser = new Analyser();
    if (this.analysers.length === 1) analyser.samples = [0.5];
    this.analysers.push(analyser);
    return analyser;
  };
  createChannelSplitter = vi.fn(() => this.splitter);
  createGain = () => this.output;
}

let context: Context;
let volume: AutoVolume;
const decibels = () => 20 * Math.log10(context.output.gain.value);
const play = () => { volume.setEnabled(true); volume.start(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  context = new Context();
  volume = new AutoVolume(context as unknown as BaseAudioContext);
});
afterEach(() => { volume.dispose(); vi.useRealTimers(); });

describe('Automatic volume balancing', () => {
  it('retains gain automation and a single timer while replacing channel probes', () => {
    play(); vi.advanceTimersByTime(300);
    const gain = context.output.gain.value;
    const updates = context.output.gain.setTargetAtTime.mock.calls.length;
    const immediateUpdates = context.output.gain.setValueAtTime.mock.calls.length;
    const oldProbes = [...context.probes];
    context.createChannelSplitter.mockImplementation(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
    volume.setChannels(6);
    expect(context.output.gain.value).toBe(gain);
    expect(context.output.gain.setTargetAtTime).toHaveBeenCalledTimes(updates);
    expect(context.output.gain.setValueAtTime).toHaveBeenCalledTimes(immediateUpdates);
    expect(vi.getTimerCount()).toBe(1);
    expect(context.input.disconnect).toHaveBeenCalledWith(context.splitter);
    const reads = oldProbes.map((probe) => probe.getFloatTimeDomainData.mock.calls.length);
    vi.advanceTimersByTime(100);
    oldProbes.forEach((probe, index) => expect(probe.getFloatTimeDomainData).toHaveBeenCalledTimes(reads[index]));
    const allocationCount = context.analysers.length;
    volume.setChannels(6);
    expect(context.analysers).toHaveLength(allocationCount);
    volume.stop(); volume.setChannels(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the audio path while disabled and polls only during enabled playback', () => {
    expect(context.input.connect).toHaveBeenCalledWith(context.output);
    expect(context.input.connect).toHaveBeenCalledWith(context.splitter);
    expect(context.createChannelSplitter).toHaveBeenCalledWith(2);
    context.probes.forEach((probe, channel) => {
      expect(context.splitter.connect).toHaveBeenCalledWith(probe, channel);
      expect(probe.connect).not.toHaveBeenCalled();
      expect(probe).toMatchObject({ channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'discrete' });
    });
    expect(context.output.gain.value).toBe(1);
    volume.start();
    vi.advanceTimersByTime(1000);
    expect(context.analyser.getFloatTimeDomainData).not.toHaveBeenCalled();
    volume.setEnabled(true);
    vi.advanceTimersByTime(300);
    expect(context.analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(3);
    expect(context.input.getFloatTimeDomainData).not.toHaveBeenCalled();
    volume.stop();
    vi.advanceTimersByTime(1000);
    expect(context.analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(3);
    volume.start();
    volume.start();
    vi.advanceTimersByTime(100);
    expect(context.analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(4);
    volume.setEnabled(false);
    expect(context.output.gain.value).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(context.analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('quickly lowers strong input toward the RMS target and never exceeds the gain floor', () => {
    play();
    vi.advanceTimersByTime(300);
    expect(decibels()).toBeCloseTo(-18 - 20 * Math.log10(0.5), 1);
    expect(context.output.gain.setTargetAtTime).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 0.02);
    context.analyser.samples = [100];
    vi.advanceTimersByTime(500);
    expect(decibels()).toBeGreaterThanOrEqual(-24.000001);
    expect(decibels()).toBeCloseTo(-24, 2);
  });

  it('measures opposite-phase stereo separately instead of boosting a cancelled mono mix', () => {
    context.probes[0].samples = [0.5, -0.5];
    context.probes[1].samples = [-0.5, 0.5];
    context.input.samples = [0];
    play();
    vi.advanceTimersByTime(1000);
    expect(decibels()).toBeCloseTo(-18 - 20 * Math.log10(0.5), 2);
    expect(context.input.getFloatTimeDomainData).not.toHaveBeenCalled();
    expect(context.probes.every((probe) => probe.getFloatTimeDomainData.mock.calls.length === 10)).toBe(true);
  });

  it.each([[6, 3], [6, 5], [8, 6]])('measures an isolated channel in %i-channel audio (index %i) without dilution', (channels, index) => {
    volume.dispose();
    context = new Context();
    volume = new AutoVolume(context as unknown as BaseAudioContext, channels);
    context.probes.forEach((probe) => { probe.samples = [0]; });
    context.probes[index].samples = [0.5, -0.5];
    play();
    vi.advanceTimersByTime(1000);
    expect(decibels()).toBeCloseTo(-18 - 20 * Math.log10(0.5), 2);
    expect(context.probes).toHaveLength(channels);
    expect(context.createChannelSplitter).toHaveBeenCalledWith(channels);
    expect(context.input.connect).toHaveBeenCalledWith(context.output);
  });

  it('observes audible input before gradually increasing gain with a two-second response', () => {
    context.analyser.samples = [0.02];
    play();
    vi.advanceTimersByTime(300);
    expect(decibels()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(decibels()).toBeGreaterThan(3);
    expect(decibels()).toBeLessThan(4.5);
    vi.advanceTimersByTime(20000);
    expect(decibels()).toBeCloseTo(6, 2);
    expect(decibels()).toBeLessThanOrEqual(6);
  });

  it('does not boost silence or very quiet noise, including after a loud passage', () => {
    context.analyser.samples = [0];
    play();
    vi.advanceTimersByTime(5000);
    expect(context.output.gain.value).toBe(1);
    context.analyser.samples = [0.001];
    vi.advanceTimersByTime(5000);
    expect(context.output.gain.value).toBe(1);
    context.analyser.samples = [0.5];
    vi.advanceTimersByTime(500);
    const attenuated = context.output.gain.value;
    context.analyser.samples = [0];
    vi.advanceTimersByTime(5000);
    expect(context.output.gain.value).toBe(attenuated);
    context.analyser.samples = [0.02];
    vi.advanceTimersByTime(300);
    expect(context.output.gain.value).toBe(attenuated);
  });

  it('uses observed peaks to avoid increasing sparse high peaks despite their low RMS', () => {
    context.probes[0].samples = [0.02];
    context.probes[1].samples = [1, ...new Array<number>(127).fill(0)];
    play();
    vi.advanceTimersByTime(5000);
    expect(context.output.gain.value).toBeCloseTo(0.95, 5);
    expect(context.output.gain.value).toBeLessThan(1);
  });

  it('limits gain jumps after timer throttling and ignores a suspended audio context', () => {
    context.analyser.samples = [0.02];
    play();
    vi.advanceTimersByTime(500);
    const before = decibels();
    context.timeOffset += 60;
    vi.advanceTimersByTime(100);
    expect(decibels() - before).toBeLessThan(1);
    const calls = context.analyser.getFloatTimeDomainData.mock.calls.length;
    context.state = 'suspended';
    vi.advanceTimersByTime(1000);
    expect(context.analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(calls);
  });

  it('resets gain and signal history for a new track and releases every resource on disposal', () => {
    context.analyser.samples = [0.02];
    play();
    vi.advanceTimersByTime(5000);
    expect(context.output.gain.value).toBeGreaterThan(1);
    volume.reset();
    expect(context.output.gain.value).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    volume.start();
    vi.advanceTimersByTime(300);
    expect(context.output.gain.value).toBe(1);
    volume.dispose();
    volume.start();
    volume.setEnabled(true);
    expect(vi.getTimerCount()).toBe(0);
    context.analysers.forEach((analyser) => { expect(analyser.disconnect).toHaveBeenCalledOnce(); });
    expect(context.splitter.disconnect).toHaveBeenCalledOnce();
    expect(context.output.disconnect).toHaveBeenCalledOnce();
  });

  it('rejects non-finite and failed measurements without scheduling an invalid gain', () => {
    context.analyser.samples = [0.02];
    play();
    vi.advanceTimersByTime(5000);
    context.analyser.samples = [NaN, Infinity];
    vi.advanceTimersByTime(100);
    expect(context.output.gain.value).toBe(1);
    context.analyser.getFloatTimeDomainData.mockImplementation(() => { throw new Error('Unavailable samples'); });
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(context.output.gain.setTargetAtTime.mock.calls.every(([value]) => Number.isFinite(value))).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });
});
