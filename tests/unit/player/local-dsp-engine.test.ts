import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalDSPEngine } from '../../../src/player/dsp/engine';
import { createLocalDSPNode, defaultLocalDSP, MAX_LOCAL_DSP_NODES, normalizeLocalDSP } from '../../../src/player/dsp/model';
import type { LocalDSPConfig, LocalDSPKind } from '../../../src/player/dsp/model';

class Parameter {
  value = 1;
  cancelAndHoldAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  setTargetAtTime = vi.fn((value: number) => { this.value = value; });
  linearRampToValueAtTime = vi.fn((value: number) => { this.value = value; });
}

class Node {
  connections = new Set<Node>();
  gain = new Parameter();
  frequency = new Parameter();
  Q = new Parameter();
  threshold = new Parameter();
  knee = new Parameter();
  ratio = new Parameter();
  attack = new Parameter();
  release = new Parameter();
  delayTime = new Parameter();
  type = '';
  channelCount = 2;
  channelCountMode = 'max';
  maxChannelCount = 8;
  fftSize = 2048;
  getFloatTimeDomainData = vi.fn((data: Float32Array) => { data.fill(0); });
  constructor(readonly category: string) {}
  connect = vi.fn((node: Node) => { this.connections.add(node); return node; });
  disconnect = vi.fn((node?: Node) => { if (node) this.connections.delete(node); else this.connections.clear(); });
}

class Context {
  static instances: Context[] = [];
  state = 'suspended';
  currentTime = 3;
  sampleRate = 32000;
  destination = new Node('destination');
  nodes: Node[] = [];
  media = new WeakSet<HTMLMediaElement>();
  constructor() { Context.instances.push(this); }
  create(category: string): Node { const node = new Node(category); this.nodes.push(node); return node; }
  createGain = () => this.create('gain');
  createBiquadFilter = () => this.create('filter');
  createDynamicsCompressor = () => this.create('compressor');
  createDelay = () => this.create('delay');
  createAnalyser = () => this.create('analyser');
  createChannelSplitter = () => this.create('splitter');
  createChannelMerger = () => this.create('merger');
  createMediaElementSource = vi.fn((media: HTMLMediaElement) => {
    if (this.media.has(media)) throw new Error('Media already attached');
    this.media.add(media);
    return this.create('source');
  });
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
}

const media = () => ({ volume: 1 } as HTMLMediaElement);
const configuration = (...kinds: LocalDSPKind[]): LocalDSPConfig => ({ enabled: true, chain: kinds.map(createLocalDSPNode) });
function outputNodes(context: Context) {
  const volume = context.nodes.find((node) => node.connections.has(context.destination))!;
  const transition = context.nodes.find((node) => node.connections.has(volume))!;
  return { volume, transition };
}

beforeEach(() => {
  Context.instances = [];
  vi.stubGlobal('AudioContext', Context);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Local DSP settings validation', () => {
  it('defaults to an enabled empty chain and repairs malformed saved parameters', () => {
    expect(normalizeLocalDSP(null)).toEqual(defaultLocalDSP());
    const raw = { enabled: false, chain: [
      { id: 'same', kind: 'gain', params: { gain: Infinity, extra: 12 } },
      { id: 'same', kind: 'equalizer', enabled: false, params: { frequency: 999999, q: -2, gain: NaN } },
      { kind: 'compressor', params: { attack: '0.2', release: -4, ratio: 50 } },
      { kind: 'unknown' }, null,
    ] };
    const result = normalizeLocalDSP(raw);
    expect(result.enabled).toBe(false);
    expect(result.chain).toHaveLength(3);
    expect(new Set(result.chain.map((node) => node.id)).size).toBe(3);
    expect(result.chain[0].params).toEqual({ gain: 0 });
    expect(result.chain[1]).toMatchObject({ enabled: false, params: { frequency: 20000, q: 0.1, gain: 0 } });
    expect(result.chain[2].params).toMatchObject({ attack: 0.003, release: 0, ratio: 20 });
    expect(raw.chain[1]).toMatchObject({ id: 'same', params: { frequency: 999999 } });
  });

  it('bounds the number of effects and returns independent default objects', () => {
    const result = normalizeLocalDSP({ chain: Array.from({ length: 100 }, () => createLocalDSPNode('gain')) });
    expect(result.chain).toHaveLength(MAX_LOCAL_DSP_NODES);
    const first = createLocalDSPNode('gain'); const second = createLocalDSPNode('gain');
    first.params.gain = 7;
    expect(second.params.gain).toBe(0);
    expect(first.id).not.toBe(second.id);
  });
});

describe('Local DSP audio graph (mock lifecycle; real rendering covered separately)', () => {
  it('changes output live while preserving source, effects, balance gain, final mute and transition', async () => {
    vi.useFakeTimers();
    const status = vi.fn(); const engine = new LocalDSPEngine(configuration('equalizer'), undefined, status);
    engine.setOutput({ layout: '7.1', expandStereo: true });
    expect(Context.instances).toHaveLength(0);
    expect(engine.inspectOutput()).toMatchObject({ maxChannels: 8, sourceChannels: null, outputChannels: null });
    const context = Context.instances[0]; expect(context.destination.channelCount).toBe(2);
    const attached = engine.attach(media());
    engine.setAutoVolume(true); await attached.resume();
    const source = context.nodes.find((node) => node.category === 'source')!;
    const filter = context.nodes.find((node) => node.category === 'filter')!;
    const autoInput = context.nodes.find((node) => node.category === 'analyser')!;
    const autoOutput = [...autoInput.connections].find((node) => node.category === 'gain')!;
    const { volume, transition } = outputNodes(context);
    autoOutput.gain.value = .25; attached.setVolume(0); attached.prepareFadeIn();
    const sourceConnections = source.connect.mock.calls.length;
    engine.setOutput({ layout: '5.1', expandStereo: false });
    expect(context.createMediaElementSource).toHaveBeenCalledOnce();
    expect(source.connect).toHaveBeenCalledTimes(sourceConnections);
    expect(filter.connections.size).toBeGreaterThan(0);
    expect(autoOutput.gain.value).toBe(.25);
    expect(autoInput.connections.has(autoOutput)).toBe(true);
    expect(volume.gain.value).toBe(0); expect(transition.gain.value).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
    expect(engine.inspectOutput()).toMatchObject({ sourceChannels: 2, outputChannels: 6, limited: false });
    const nodes = context.nodes.length;
    engine.setOutput({ layout: '5.1', expandStereo: false }); expect(context.nodes).toHaveLength(nodes);
    attached.pause(); engine.setOutput({ layout: 'stereo', expandStereo: false });
    expect(vi.getTimerCount()).toBe(0); expect(volume.gain.value).toBe(0);
    const plainNodes = context.nodes.length;
    engine.setOutput({ layout: 'stereo', expandStereo: true }); expect(context.nodes).toHaveLength(plainNodes);
    engine.dispose(); expect(vi.getTimerCount()).toBe(0);
    expect(context.nodes.every((node) => node.connections.size === 0)).toBe(true);
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ sourceChannels: null, outputChannels: null, maxChannels: null }));
  });

  it('keeps the previous route after allocation failure and preserves an unrelated resume error on recovery', async () => {
    const report = vi.fn(); const engine = new LocalDSPEngine(defaultLocalDSP(), report);
    const attached = engine.attach(media()); const context = Context.instances[0];
    context.resume.mockRejectedValue(new DOMException('Gesture required', 'NotAllowedError'));
    await expect(attached.resume()).rejects.toMatchObject({ name: 'NotAllowedError' });
    const createMerger = context.createChannelMerger;
    context.createChannelMerger = () => { throw new Error('Allocation failed'); };
    expect(() => engine.setOutput({ layout: '7.1', expandStereo: true })).not.toThrow();
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining('输出更新失败'));
    expect(engine.inspectOutput()).toMatchObject({ outputChannels: 2, limited: true });
    expect(context.destination.channelCount).toBe(2);
    context.createChannelMerger = createMerger;
    engine.setOutput({ layout: '7.1', expandStereo: true });
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining('点击播放'));
    context.resume.mockImplementation(async () => { context.state = 'running'; });
    await attached.resume(); expect(report).toHaveBeenLastCalledWith(null);
    engine.dispose(); expect(context.nodes.every((node) => node.connections.size === 0)).toBe(true);
  });

  it('runs auto volume only during enabled playback and clears sampling on pause, seek and detach', async () => {
    vi.useFakeTimers();
    const engine = new LocalDSPEngine(configuration('gain')); engine.setAutoVolume(true);
    const attached = engine.attach(media()); const context = Context.instances[0];
    attached.setVolume(0.3); expect(vi.getTimerCount()).toBe(0);
    await attached.resume(); expect(vi.getTimerCount()).toBe(1);
    const [input, analyser] = context.nodes.filter((node) => node.category === 'analyser');
    context.currentTime += 0.25;
    await vi.advanceTimersByTimeAsync(250);
    expect(analyser.getFloatTimeDomainData).toHaveBeenCalled();
    expect(input.getFloatTimeDomainData).not.toHaveBeenCalled();
    expect(outputNodes(context).volume.gain.value).toBe(0.3);
    attached.pause(); expect(vi.getTimerCount()).toBe(0);
    engine.setAutoVolume(false); engine.setAutoVolume(true); expect(vi.getTimerCount()).toBe(0);
    await attached.resume(); attached.reset(); expect(vi.getTimerCount()).toBe(1);
    const oldCalls = analyser.getFloatTimeDomainData.mock.calls.length;
    context.currentTime += 0.25;
    await vi.advanceTimersByTimeAsync(250);
    expect(analyser.getFloatTimeDomainData.mock.calls.length).toBe(oldCalls);
    expect(analyser.connections.size).toBe(0);
    engine.setAutoVolume(false); expect(vi.getTimerCount()).toBe(0);
    engine.setAutoVolume(true); expect(vi.getTimerCount()).toBe(1);
    attached.detach(); expect(vi.getTimerCount()).toBe(0);
    engine.dispose();
  });

  it('uses a separate linear song transition without changing the latest user volume', async () => {
    vi.useFakeTimers();
    const engine = new LocalDSPEngine(configuration('gain')); const attached = engine.attach(media());
    await attached.resume(); const context = Context.instances[0];
    const { volume, transition } = outputNodes(context);
    attached.setVolume(0.3);
    let finished = false;
    const faded = attached.fadeOut(300).then(() => { finished = true; });
    expect(transition.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 3.3);
    expect(volume.gain.value).toBe(0.3);
    attached.setVolume(0.7);
    await vi.advanceTimersByTimeAsync(299); expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await faded;
    expect(volume.gain.value).toBe(0.7);
    attached.fadeIn(300);
    expect(transition.gain.setValueAtTime).toHaveBeenCalledWith(0, 3);
    expect(transition.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 3.3);
    expect(volume.gain.value).toBe(0.7);
    expect(vi.getTimerCount()).toBe(0);
    engine.dispose();
  });

  it('resolves cancelled transitions and clears their timer on pause, reset and detach', async () => {
    vi.useFakeTimers();
    for (const action of ['pause', 'reset', 'detach'] as const) {
      const engine = new LocalDSPEngine(configuration('reverb')); const attached = engine.attach(media());
      await attached.resume(); attached.setVolume(0.4);
      const context = Context.instances.at(-1)!;
      const previous = outputNodes(context);
      let finished = false;
      const faded = attached.fadeOut(300).then(() => { finished = true; });
      await attached[action](); await Promise.resolve();
      expect(finished).toBe(true); await faded;
      expect(vi.getTimerCount()).toBe(0);
      expect(previous.transition.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 3);
      if (action === 'pause') expect(previous.volume.gain.value).toBe(0);
      else if (action !== 'detach') expect(outputNodes(context).volume.gain.value).toBe(0.4);
      engine.dispose();
    }
  });

  it('continues repeated fade-outs from the current gain and resolves the superseded fade with one timer', async () => {
    vi.useFakeTimers();
    const engine = new LocalDSPEngine(configuration('gain')); const attached = engine.attach(media());
    await attached.resume(); const context = Context.instances[0];
    const { transition } = outputNodes(context);
    let firstFinished = false;
    const first = attached.fadeOut(300).then(() => { firstFinished = true; });
    await vi.advanceTimersByTimeAsync(100);
    context.currentTime = 3.1;
    transition.gain.value = 0.35;
    transition.gain.setValueAtTime.mockClear();
    transition.gain.cancelAndHoldAtTime.mockClear();
    const second = attached.fadeOut(300);
    await first;
    expect(firstFinished).toBe(true);
    expect(transition.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(3.1);
    expect(transition.gain.setValueAtTime).toHaveBeenLastCalledWith(0.35, 3.1);
    expect(transition.gain.setValueAtTime).not.toHaveBeenCalledWith(1, 3.1);
    expect(transition.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 3.4);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(300); await second;
    expect(vi.getTimerCount()).toBe(0);
    engine.dispose();
  });

  it('prepares a silent fade-in before playback and does not reset it during context resume', async () => {
    const engine = new LocalDSPEngine(configuration('gain')); const attached = engine.attach(media());
    const { volume, transition } = outputNodes(Context.instances[0]);
    attached.setVolume(0.6); attached.prepareFadeIn();
    expect(transition.gain.value).toBe(0);
    await attached.resume(); expect(transition.gain.value).toBe(0);
    attached.fadeIn(300); const resets = transition.gain.cancelScheduledValues.mock.calls.length;
    await attached.resume(); expect(transition.gain.cancelScheduledValues.mock.calls.length).toBe(resets);
    expect(volume.gain.value).toBe(0.6);
    engine.dispose();
  });

  it('bounds fade duration and keeps muted and paused output silent', async () => {
    vi.useFakeTimers();
    const engine = new LocalDSPEngine(configuration('gain')); const attached = engine.attach(media());
    await attached.resume(); const { volume, transition } = outputNodes(Context.instances[0]);
    attached.setVolume(0); attached.fadeIn(500);
    expect(volume.gain.value).toBe(0);
    const bounded = attached.fadeOut(9000);
    expect(transition.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 5);
    await vi.advanceTimersByTimeAsync(2000); await bounded;
    const invalid = attached.fadeOut(NaN);
    expect(transition.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 3.3);
    attached.pause(); await invalid;
    attached.setVolume(0.9); attached.fadeIn(500);
    expect(volume.gain.value).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await attached.resume(); await attached.fadeOut(-1);
    expect(transition.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 3);
    expect(vi.getTimerCount()).toBe(0);
    engine.dispose();
  });

  it('changes parameters smoothly without recreating media sources or reconnecting the chain', () => {
    const config = configuration('gain', 'equalizer', 'compressor', 'reverb');
    const engine = new LocalDSPEngine(config);
    const attached = engine.attach(media());
    const context = Context.instances[0];
    const nodes = [...context.nodes];
    const connections = nodes.map((node) => node.connect.mock.calls.length);
    config.chain[0].params.gain = -6;
    Object.assign(config.chain[1].params, { frequency: 20000, q: 3, gain: 5 });
    Object.assign(config.chain[2].params, { ratio: 8, attack: 0.1 });
    Object.assign(config.chain[3].params, { decay: 6, tone: 20000, mix: 0.7 });
    engine.setConfig(config);
    expect(context.nodes).toEqual(nodes);
    expect(nodes.map((node) => node.connect.mock.calls.length)).toEqual(connections);
    expect(context.createMediaElementSource).toHaveBeenCalledOnce();
    const equalizer = nodes.find((node) => node.type === 'peaking')!;
    expect(equalizer.frequency.setTargetAtTime).toHaveBeenLastCalledWith(16000, 3, 0.01);
    expect(equalizer.Q.setTargetAtTime).toHaveBeenLastCalledWith(3, 3, 0.01);
    expect(equalizer.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(3);
    expect(nodes.find((node) => node.category === 'compressor')!.ratio.value).toBe(8);
    expect(nodes.filter((node) => node.type === 'lowpass').every((node) => node.frequency.value === 16000)).toBe(true);
    expect(nodes.some((node) => Math.abs(node.gain.value - 10 ** (-6 / 20)) < 1e-10)).toBe(true);
    attached.detach(); engine.dispose();
  });

  it('reuses nodes for bypass and reordering, then releases removed effects', () => {
    const config = configuration('gain', 'equalizer');
    const engine = new LocalDSPEngine(config);
    engine.attach(media());
    const context = Context.instances[0]; const count = context.nodes.length;
    config.chain[0].enabled = false; config.enabled = false;
    engine.setConfig(config);
    expect(context.nodes).toHaveLength(count);
    config.chain.reverse(); engine.setConfig(config);
    expect(context.nodes).toHaveLength(count);
    expect(context.createMediaElementSource).toHaveBeenCalledOnce();
    const filter = context.nodes.find((node) => node.type === 'peaking')!;
    config.chain.shift(); engine.setConfig(config);
    expect(filter.connections.size).toBe(0);
    expect(filter.disconnect).toHaveBeenCalled();
    engine.dispose();
    expect(context.nodes.every((node) => node.connections.size === 0)).toBe(true);
  });

  it('puts player volume after every effect and bypass path', () => {
    const engine = new LocalDSPEngine(configuration('reverb'));
    const attached = engine.attach(media()); const context = Context.instances[0];
    const outputs = context.nodes.filter((node) => node.connections.has(context.destination));
    expect(outputs).toHaveLength(1);
    attached.setVolume(0);
    expect(outputs[0].gain.value).toBe(0);
    expect(outputs[0].gain.setTargetAtTime).not.toHaveBeenCalled();
    attached.setVolume(0.4);
    expect(outputs[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0.4, 3, 0.01);
    attached.setVolume(2); expect(outputs[0].gain.value).toBe(1);
    attached.setVolume(NaN); expect(outputs[0].gain.value).toBe(1);
    engine.dispose();
  });

  it('preserves negotiated surround channels through independent mono compressors', () => {
    const engine = new LocalDSPEngine(configuration('compressor'));
    engine.attach(media(), 6);
    const context = Context.instances[0];
    const compressors = context.nodes.filter((node) => node.category === 'compressor');
    expect(compressors).toHaveLength(6);
    expect(compressors.every((node) => node.channelCount === 1 && node.channelCountMode === 'explicit')).toBe(true);
    expect(context.nodes.filter((node) => node.category === 'splitter')).toHaveLength(2);
    expect(context.nodes.filter((node) => node.category === 'analyser')).toHaveLength(7);
    expect(context.nodes.filter((node) => node.category === 'merger')).toHaveLength(1);
    expect(context.destination.channelCount).toBe(6);
    engine.dispose();
  });

  it('mutes pause immediately including reverb tails, remembers volume and resets seek state without a new source', async () => {
    const engine = new LocalDSPEngine(configuration('reverb'));
    const attached = engine.attach(media()); const context = Context.instances[0];
    let output = context.nodes.find((node) => node.connections.has(context.destination))!;
    attached.setVolume(0.6); attached.pause();
    expect(output.gain.value).toBe(0);
    expect(output.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 3);
    attached.setVolume(0.2); expect(output.gain.value).toBe(0);
    const oldNodes = [...context.nodes];
    attached.reset();
    expect(context.createMediaElementSource).toHaveBeenCalledOnce();
    expect(oldNodes.filter((node) => node.category !== 'source').every((node) => node.connections.size === 0)).toBe(true);
    output = context.nodes.find((node) => node.connections.has(context.destination))!;
    expect(output.gain.value).toBe(0);
    await attached.resume();
    expect(output.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.2, 3, 0.01);
    engine.dispose();
  });

  it('does not undo a newer pause when an earlier context resume finishes', async () => {
    const engine = new LocalDSPEngine(configuration('reverb'));
    const attached = engine.attach(media()); const context = Context.instances[0];
    let resolve!: () => void;
    context.resume.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const playing = attached.resume();
    attached.pause(); context.state = 'running'; resolve(); await playing;
    const output = context.nodes.find((node) => node.connections.has(context.destination))!;
    expect(output.gain.value).toBe(0);
    engine.dispose();
  });

  it('bounds a permanently pending resume and clears timers on success or disposal', async () => {
    vi.useFakeTimers();
    const engine = new LocalDSPEngine(configuration('gain'));
    const attached = engine.attach(media()); const context = Context.instances[0];
    context.resume.mockImplementation(() => new Promise<void>(() => {}));
    const denied = expect(attached.resume()).rejects.toMatchObject({ name: 'NotAllowedError' });
    await vi.advanceTimersByTimeAsync(1500); await denied;
    expect(vi.getTimerCount()).toBe(0);
    const disposed = expect(attached.resume()).rejects.toMatchObject({ name: 'AbortError' });
    engine.dispose(); await disposed;
    expect(vi.getTimerCount()).toBe(0);
    engine.unlock(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    engine.dispose();
  });

  it('surfaces routing failure after a media source has captured native output', () => {
    const report = vi.fn(); const engine = new LocalDSPEngine(configuration('gain'), report);
    engine.unlock(); const context = Context.instances[0];
    context.createMediaElementSource.mockImplementation(() => {
      const source = context.create('source');
      source.connect.mockImplementation(() => { throw new Error('Route failed'); });
      return source;
    });
    expect(() => engine.attach(media())).toThrow('Local DSP audio routing failed');
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining('路由失败'));
    engine.dispose(); expect(report).toHaveBeenLastCalledWith(null);
  });

  it('shares a context across songs, disconnects feedback on detach and never duplicates a media source', async () => {
    const engine = new LocalDSPEngine(configuration('reverb'));
    const audio = media();
    const first = engine.attach(audio); const context = Context.instances[0];
    const oldNodes = [...context.nodes];
    const second = engine.attach(media());
    first.detach(); first.detach();
    expect(oldNodes.every((node) => node.connections.size === 0)).toBe(true);
    expect(context.nodes.slice(oldNodes.length).some((node) => node.connections.size > 0)).toBe(true);
    await second.resume(); expect(context.state).toBe('running');
    engine.attach(audio);
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(2);
    expect(Context.instances).toHaveLength(1);
    engine.dispose(); expect(context.close).toHaveBeenCalledOnce();
    expect(context.nodes.every((node) => node.connections.size === 0)).toBe(true);
    engine.unlock(); await Promise.resolve();
    expect(Context.instances).toHaveLength(2);
    engine.dispose();
  });

  it('reports unavailable Web Audio and preserves native playback volume', async () => {
    vi.stubGlobal('AudioContext', undefined); vi.stubGlobal('webkitAudioContext', undefined);
    const report = vi.fn(); const engine = new LocalDSPEngine(configuration('gain'), report);
    const audio = media(); const attached = engine.attach(audio);
    expect(LocalDSPEngine.supported()).toBe(false);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('不支持'));
    attached.setVolume(0.3); expect(audio.volume).toBe(0.3);
    await attached.fadeOut(300); attached.fadeIn(300); expect(audio.volume).toBe(0.3);
    await expect(attached.resume()).resolves.toBeUndefined();
    engine.unlock(); expect(report).toHaveBeenCalledOnce(); engine.dispose();
  });

  it('synchronously resumes on a gesture and propagates autoplay denial without unhandled unlock rejection', async () => {
    const report = vi.fn(); const engine = new LocalDSPEngine(configuration('gain'), report);
    const attached = engine.attach(media()); const context = Context.instances[0];
    const denied = new DOMException('Gesture required', 'NotAllowedError');
    context.resume.mockRejectedValue(denied);
    engine.unlock(); expect(context.resume).toHaveBeenCalledOnce();
    await expect(attached.resume()).rejects.toBe(denied);
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining('点击播放'));
    context.resume.mockImplementation(async () => { context.state = 'running'; });
    await attached.resume(); expect(report).toHaveBeenLastCalledWith(null);
    engine.dispose();
  });

  it('cleans partially built graphs and keeps initialization errors visible after context resume', async () => {
    const report = vi.fn(); const engine = new LocalDSPEngine(configuration('compressor'), report);
    engine.unlock(); const context = Context.instances[0];
    context.createDynamicsCompressor = () => { throw new Error('Node allocation failed'); };
    const attached = engine.attach(media());
    await attached.resume(); await Promise.resolve();
    expect(context.createMediaElementSource).not.toHaveBeenCalled();
    expect(context.nodes.every((node) => node.connections.size === 0)).toBe(true);
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining('初始化失败'));
    engine.dispose();
  });
});
