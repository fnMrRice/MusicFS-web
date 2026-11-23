import type { LocalDSPConfig } from './model';
import { createEffectUnit, smooth } from './nodes';
import type { EffectUnit } from './nodes';
import { AutoVolume } from './auto-volume';
import { AudioOutputRouting } from './output-routing';
import { defaultAudioOutput } from './output';
import type { AudioOutputConfig } from './output';

/** 每个媒体源拥有独立效果链，换歌释放全部内部连接，避免上一首混响残留。 */
export class LocalDSPGraph {
  readonly input: GainNode;
  private readonly dry: GainNode;
  private readonly gate: GainNode;
  private readonly wet: GainNode;
  private readonly volume: GainNode;
  private readonly transition: GainNode;
  private readonly autoVolume: AutoVolume;
  private routing: AudioOutputRouting;
  private outputConfig = defaultAudioOutput();
  private units = new Map<string, EffectUnit>();
  private order = '';
  private initialized = false;
  private volumeInitialized = false;
  private volumeValue = 1;
  private paused = false;

  constructor(private readonly context: BaseAudioContext, config: LocalDSPConfig, readonly channels = 2) {
    this.input = context.createGain();
    this.dry = context.createGain();
    this.gate = context.createGain();
    this.wet = context.createGain();
    this.volume = context.createGain();
    this.transition = context.createGain();
    this.autoVolume = new AutoVolume(context, channels);
    this.routing = new AudioOutputRouting(context, channels, channels, false);
    this.input.connect(this.dry).connect(this.routing.input);
    this.input.connect(this.gate);
    this.wet.connect(this.routing.input);
    this.routing.output.connect(this.autoVolume.input);
    for (const node of [this.transition, this.volume]) node.channelInterpretation = 'discrete';
    this.autoVolume.output.connect(this.transition).connect(this.volume).connect(context.destination);
    try { this.update(config); }
    catch (error) { this.dispose(); throw error; }
  }

  update(config: LocalDSPConfig): void {
    const nextOrder = JSON.stringify(config.chain.map((node) => [node.id, node.kind]));
    const created = new Map<string, EffectUnit>();
    try {
      for (const node of config.chain) {
        const existing = this.units.get(node.id);
        if (!existing || existing.kind !== node.kind) created.set(node.id, createEffectUnit(this.context, node, this.channels));
      }
    } catch (error) {
      for (const unit of created.values()) unit.dispose();
      throw error;
    }
    if (nextOrder !== this.order || !this.initialized) {
      this.gate.disconnect();
      for (const unit of this.units.values()) unit.output.disconnect();
      const retained = new Map<string, EffectUnit>();
      let previous: AudioNode = this.gate;
      for (const node of config.chain) {
        const unit = created.get(node.id) ?? this.units.get(node.id)!;
        retained.set(node.id, unit);
        previous.connect(unit.input);
        previous = unit.output;
      }
      previous.connect(this.wet);
      for (const [id, unit] of this.units) if (retained.get(id) !== unit) unit.dispose();
      this.units = retained;
      this.order = nextOrder;
    }
    for (const node of config.chain) this.units.get(node.id)!.update(node);
    smooth(this.dry.gain, config.enabled ? 0 : 1, this.context, !this.initialized);
    smooth(this.gate.gain, config.enabled ? 1 : 0, this.context, !this.initialized);
    smooth(this.wet.gain, config.enabled ? 1 : 0, this.context, !this.initialized);
    this.initialized = true;
  }

  setVolume(value: number): void {
    this.volumeValue = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
    smooth(this.volume.gain, this.paused ? 0 : this.volumeValue, this.context, this.paused || !this.volumeInitialized);
    this.volumeInitialized = true;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    smooth(this.volume.gain, paused ? 0 : this.volumeValue, this.context, paused);
    if (paused) this.autoVolume.stop(); else this.autoVolume.start();
  }

  setAutoVolume(enabled: boolean): void { this.autoVolume.setEnabled(enabled); }

  get outputChannels(): number { return this.routing.channels; }

  setOutput(config: AudioOutputConfig, channels: number): void {
    const expandStereo = config.expandStereo && this.channels === 2 && channels >= 6;
    if (channels === this.outputChannels && expandStereo === this.outputConfig.expandStereo) return;
    const routing = new AudioOutputRouting(this.context, this.channels, channels, expandStereo);
    try {
      routing.output.connect(this.autoVolume.input);
      this.dry.connect(routing.input); this.wet.connect(routing.input);
      this.autoVolume.setChannels(channels);
    } catch (error) {
      try { this.dry.disconnect(routing.input); this.wet.disconnect(routing.input); } catch { /* 连接失败时可能尚未建立目标连接。 */ }
      routing.dispose(); throw error;
    }
    this.dry.disconnect(this.routing.input); this.wet.disconnect(this.routing.input);
    this.routing.dispose(); this.routing = routing; this.outputConfig = { ...config, expandStereo };
  }

  // 播放过渡使用独立增益，不改用户音量，也不会绕过暂停或静音状态。
  fadeTo(target: 0 | 1, durationMs: number): number {
    const duration = Number.isFinite(durationMs) ? Math.max(0, Math.min(2000, durationMs)) : 300;
    const param = this.transition.gain;
    const now = this.context.currentTime;
    const current = param.value;
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues(now);
    // 没有后续自动化时 cancelAndHold 不一定新增事件；显式锚定当前值，避免从旧事件开始渐变。
    param.setValueAtTime(current, now);
    if (duration === 0) param.setValueAtTime(target, now);
    else param.linearRampToValueAtTime(target, now + duration / 1000);
    return duration;
  }

  fadeIn(durationMs: number): void {
    smooth(this.transition.gain, 0, this.context, true);
    this.fadeTo(1, durationMs);
  }

  cancelFade(): void {
    smooth(this.transition.gain, 1, this.context, true);
  }

  dispose(): void {
    this.autoVolume.dispose();
    this.routing.dispose();
    for (const unit of this.units.values()) unit.dispose();
    this.units.clear();
    for (const node of [this.input, this.dry, this.gate, this.wet, this.volume, this.transition]) node.disconnect();
  }
}
