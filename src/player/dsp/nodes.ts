import type { LocalDSPNode } from './model';
import { graphicEqualizerBands } from './graphic-equalizer';

export interface EffectUnit {
  kind: LocalDSPNode['kind'];
  input: GainNode;
  output: GainNode;
  update(node: LocalDSPNode): void;
  dispose(): void;
}

// 短时间常数避免滑块操作产生阶跃；取消旧自动化可控制连续拖动的事件数量。
export function smooth(param: AudioParam, value: number, context: BaseAudioContext, initial = false): void {
  if (initial) {
    param.cancelScheduledValues(context.currentTime);
    param.value = value;
    param.setValueAtTime(value, context.currentTime);
    return;
  }
  const now = context.currentTime;
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
  else {
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
  }
  param.setTargetAtTime(value, now, 0.01);
}

export function createEffectUnit(context: BaseAudioContext, node: LocalDSPNode, channels = 2): EffectUnit {
  const owned: AudioNode[] = [];
  const own = <T extends AudioNode>(value: T): T => { owned.push(value); return value; };
  const dispose = () => { for (const item of owned) item.disconnect(); };
  try {
    const input = own(context.createGain());
    const output = own(context.createGain());
    const dry = own(context.createGain());
    const gate = own(context.createGain());
    const wet = own(context.createGain());
    input.connect(dry).connect(output);
    input.connect(gate);
    wet.connect(output);
    let initialized = false;
    const set = (param: AudioParam, value: number) => smooth(param, value, context, !initialized);
    let updateEffect: (params: Record<string, number>) => void;

    if (node.kind === 'gain') {
      const effect = own(context.createGain());
      gate.connect(effect).connect(wet);
      updateEffect = (params) => set(effect.gain, 10 ** (params.gain / 20));
    } else if (node.kind === 'equalizer') {
      const effect = own(context.createBiquadFilter());
      effect.type = 'peaking';
      gate.connect(effect).connect(wet);
      updateEffect = (params) => {
        set(effect.frequency, Math.min(params.frequency, context.sampleRate / 2));
        set(effect.Q, params.q);
        set(effect.gain, params.gain);
      };
    } else if (node.kind === 'graphicEqualizer') {
      let previous: AudioNode = gate;
      const bands = graphicEqualizerBands.map((band) => {
        const effect = own(context.createBiquadFilter());
        effect.type = 'peaking';
        effect.frequency.value = Math.min(band.frequency, context.sampleRate / 2);
        effect.Q.value = Math.SQRT2;
        previous.connect(effect);
        previous = effect;
        return { key: band.key, effect };
      });
      // 低音与高音增强是效果链末端的真实棚式滤波，不改变其他频段滑块的数值。
      const bass = own(context.createBiquadFilter());
      bass.type = 'lowshelf';
      bass.frequency.value = Math.min(120, context.sampleRate / 2);
      const treble = own(context.createBiquadFilter());
      treble.type = 'highshelf';
      treble.frequency.value = Math.min(6000, context.sampleRate / 2);
      previous.connect(bass).connect(treble).connect(wet);
      updateEffect = (params) => {
        for (const band of bands) set(band.effect.gain, params[band.key]);
        set(bass.gain, params.bassGain);
        set(treble.gain, params.trebleGain);
      };
    } else if (node.kind === 'compressor') {
      // 原生压缩器最多支持双声道；环绕声按声道独立处理后恢复原有布局。
      const effects: DynamicsCompressorNode[] = [];
      if (channels <= 2) {
        const effect = own(context.createDynamicsCompressor());
        effect.channelCount = channels;
        gate.connect(effect).connect(wet);
        effects.push(effect);
      } else {
        const splitter = own(context.createChannelSplitter(channels));
        const merger = own(context.createChannelMerger(channels));
        gate.connect(splitter);
        for (let channel = 0; channel < channels; channel++) {
          const effect = own(context.createDynamicsCompressor());
          effect.channelCount = 1;
          effect.channelCountMode = 'explicit';
          splitter.connect(effect, channel);
          effect.connect(merger, 0, channel);
          effects.push(effect);
        }
        merger.connect(wet);
      }
      updateEffect = (params) => {
        for (const effect of effects) {
          set(effect.threshold, params.threshold);
          set(effect.knee, params.knee);
          set(effect.ratio, params.ratio);
          set(effect.attack, params.attack);
          set(effect.release, params.release);
        }
      };
    } else {
      const original = own(context.createGain());
      const reflections = own(context.createGain());
      gate.connect(original).connect(wet);
      reflections.connect(wet);
      // 四路反馈梳状滤波保持实时参数更新；每路注入量补偿反馈，控制低频累积。
      const branches = [0.0297, 0.0371, 0.0411, 0.0437].map((seconds) => {
        const injection = own(context.createGain());
        const delay = own(context.createDelay(0.1));
        const filter = own(context.createBiquadFilter());
        const feedback = own(context.createGain());
        const level = own(context.createGain());
        delay.delayTime.value = seconds;
        filter.type = 'lowpass';
        filter.Q.value = Math.SQRT1_2;
        level.gain.value = 0.25;
        gate.connect(injection).connect(delay).connect(filter);
        filter.connect(feedback).connect(delay);
        filter.connect(level).connect(reflections);
        return { seconds, injection, feedback, filter };
      });
      updateEffect = (params) => {
        set(original.gain, 1 - params.mix);
        set(reflections.gain, params.mix);
        for (const branch of branches) {
          const feedback = Math.pow(0.001, branch.seconds / params.decay);
          set(branch.feedback.gain, feedback);
          set(branch.injection.gain, 1 - feedback);
          set(branch.filter.frequency, Math.min(params.tone, context.sampleRate / 2));
        }
      };
    }

    const unit: EffectUnit = {
      kind: node.kind, input, output, dispose,
      update(next) {
        set(dry.gain, next.enabled ? 0 : 1);
        set(gate.gain, next.enabled ? 1 : 0);
        set(wet.gain, next.enabled ? 1 : 0);
        updateEffect(next.params);
        initialized = true;
      },
    };
    unit.update(node);
    return unit;
  } catch (error) {
    dispose();
    throw error;
  }
}
