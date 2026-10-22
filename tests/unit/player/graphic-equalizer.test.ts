import { describe, expect, it, vi } from 'vitest';
import { createEffectUnit } from '../../../src/player/dsp/nodes';
import { createLocalDSPNode, normalizeLocalDSP } from '../../../src/player/dsp/model';
import { graphicEqualizerBands, graphicEqualizerPresets } from '../../../src/player/dsp/graphic-equalizer';

class Parameter {
  value = 0;
  cancelScheduledValues = vi.fn();
  cancelAndHoldAtTime = vi.fn();
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  setTargetAtTime = vi.fn((value: number) => { this.value = value; });
}

class Node {
  type = '';
  gain = new Parameter();
  frequency = new Parameter();
  Q = new Parameter();
  connections = new Set<Node>();
  connect = vi.fn((node: Node) => { this.connections.add(node); return node; });
  disconnect = vi.fn(() => { this.connections.clear(); });
}

function context(sampleRate = 48000) {
  const nodes: Node[] = [];
  const filters: Node[] = [];
  const createGain = () => { const node = new Node(); nodes.push(node); return node; };
  const createBiquadFilter = () => { const node = createGain(); filters.push(node); return node; };
  const audio = { currentTime: 7, sampleRate, createGain, createBiquadFilter } as unknown as BaseAudioContext;
  return { audio, nodes, filters };
}

describe('Ten-band graphical equalizer', () => {
  it('starts flat, bounds all bands and shelf gains, and keeps the existing parametric effect', () => {
    const node = createLocalDSPNode('graphicEqualizer');
    expect(Object.keys(node.params)).toHaveLength(12);
    expect(Object.values(node.params).every((value) => value === 0)).toBe(true);
    const normalized = normalizeLocalDSP({ enabled: true, chain: [{
      ...node, params: { band31: Infinity, band63: -99, band1000: 99, band16000: NaN, bassGain: -5, trebleGain: 99 },
    }] }).chain[0];
    expect(normalized.params).toMatchObject({ band31: 0, band63: -12, band1000: 12, band16000: 0, bassGain: 0, trebleGain: 12 });
    expect(createLocalDSPNode('equalizer').params).toEqual({ frequency: 1000, q: 1, gain: 0 });
  });

  it('defines complete, distinct presets that can be adjusted without mutating shared defaults', () => {
    const expectedKeys = [...graphicEqualizerBands.map((band) => band.key), 'bassGain', 'trebleGain'].sort();
    expect(graphicEqualizerPresets.map((preset) => preset.id)).toEqual(['flat', 'pop', 'rock', 'vocal']);
    expect(new Set(graphicEqualizerPresets.map((preset) => JSON.stringify(preset.params))).size).toBe(4);
    for (const preset of graphicEqualizerPresets) {
      expect(Object.keys(preset.params).sort()).toEqual(expectedKeys);
      expect(Object.values(preset.params).every((value) => Number.isFinite(value) && value >= -12 && value <= 12)).toBe(true);
    }
    const customized = { ...graphicEqualizerPresets[0].params, band31: 6 };
    expect(customized.band31).toBe(6);
    expect(graphicEqualizerPresets[0].params.band31).toBe(0);
  });

  it('routes ten peaking filters and two actual shelf filters in series and reuses them during updates', () => {
    const setup = context();
    const node = createLocalDSPNode('graphicEqualizer');
    const unit = createEffectUnit(setup.audio, node);
    expect(setup.filters).toHaveLength(12);
    expect(setup.filters.slice(0, 10).map((filter) => filter.type)).toEqual(Array(10).fill('peaking'));
    expect(setup.filters.slice(0, 10).map((filter) => filter.frequency.value)).toEqual(graphicEqualizerBands.map((band) => band.frequency));
    expect(setup.filters.slice(0, 10).every((filter) => filter.Q.value === Math.SQRT2)).toBe(true);
    expect(setup.filters[10]).toMatchObject({ type: 'lowshelf', frequency: { value: 120 } });
    expect(setup.filters[11]).toMatchObject({ type: 'highshelf', frequency: { value: 6000 } });
    for (let index = 0; index < 11; index++) expect(setup.filters[index].connections.has(setup.filters[index + 1])).toBe(true);
    const allocated = [...setup.nodes];
    const connections = allocated.map((item) => item.connect.mock.calls.length);
    const adjusted = { ...node, params: { ...node.params, band31: -12, band1000: 6, band16000: 12, bassGain: 3, trebleGain: 5 } };
    unit.update(adjusted);
    expect(setup.nodes).toEqual(allocated);
    expect(allocated.map((item) => item.connect.mock.calls.length)).toEqual(connections);
    expect(setup.filters[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(-12, 7, 0.01);
    expect(setup.filters[5].gain.setTargetAtTime).toHaveBeenLastCalledWith(6, 7, 0.01);
    expect(setup.filters[9].gain.setTargetAtTime).toHaveBeenLastCalledWith(12, 7, 0.01);
    expect(setup.filters[10].gain.setTargetAtTime).toHaveBeenLastCalledWith(3, 7, 0.01);
    expect(setup.filters[11].gain.setTargetAtTime).toHaveBeenLastCalledWith(5, 7, 0.01);
    unit.update({ ...adjusted, enabled: false });
    expect(setup.nodes).toEqual(allocated);
    expect(setup.filters[5].gain.value).toBe(6);
    unit.dispose();
    expect(allocated.every((item) => item.connections.size === 0)).toBe(true);
  });

  it('keeps every filter within the actual sample-rate frequency range', () => {
    const setup = context(16000);
    const unit = createEffectUnit(setup.audio, createLocalDSPNode('graphicEqualizer'));
    expect(setup.filters.every((filter) => filter.frequency.value > 0 && filter.frequency.value <= 8000)).toBe(true);
    expect(setup.filters[9].frequency.value).toBe(8000);
    unit.dispose();
  });
});
