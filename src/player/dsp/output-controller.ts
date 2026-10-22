import { defaultAudioOutput, normalizeAudioOutput, outputChannelCount, supportedOutputChannels, validChannelCount } from './output';
import type { AudioOutputConfig, AudioOutputStatus } from './output';
import type { LocalDSPGraph } from './graph';

/** 管理设备能力与正在播放的图；探测本身不会修改硬件声道数。 */
export class AudioOutputController {
  private config = defaultAudioOutput();
  private context?: AudioContext;
  private graphs = new Set<LocalDSPGraph>();
  private previous = '';
  private mediaDevices?: MediaDevices;
  private refreshDevice = () => { this.refresh(); };

  constructor(private readonly supported: () => boolean, private readonly changed?: (status: AudioOutputStatus) => void,
    private readonly failed?: (failed: boolean) => void) {}

  bind(context: AudioContext): void {
    this.unbind();
    this.context = context;
    context.addEventListener?.('sinkchange', this.refreshDevice);
    try {
      this.mediaDevices = globalThis.navigator?.mediaDevices;
      this.mediaDevices?.addEventListener?.('devicechange', this.refreshDevice);
    } catch { /* 设备权限不可用不影响已有输出。 */ }
    this.publish();
  }

  private unbind(): void {
    this.context?.removeEventListener?.('sinkchange', this.refreshDevice);
    this.mediaDevices?.removeEventListener?.('devicechange', this.refreshDevice);
    this.mediaDevices = undefined;
  }

  private maximum(): number | null {
    try { return validChannelCount(this.context?.destination.maxChannelCount); }
    catch { return null; }
  }

  private current(): number {
    try { return validChannelCount(this.context?.destination.channelCount) ?? 2; }
    catch { return 2; }
  }

  setConfig(config: AudioOutputConfig): void { this.config = normalizeAudioOutput(config); this.refresh(); }

  add(graph: LocalDSPGraph): void {
    this.graphs.add(graph);
    try { this.refresh(true); }
    catch (error) { this.graphs.delete(graph); this.publish(); throw error; }
  }

  remove(graph: LocalDSPGraph): void { this.graphs.delete(graph); this.refresh(); }

  inspect(): AudioOutputStatus { this.refresh(); return this.status(); }

  private refresh(strict = false): void {
    const previousCount = this.current();
    try { this.apply(); this.failed?.(false); }
    catch (error) {
      // 新图尚未替换旧图时，恢复原设备配置，保留正在播放的声音。
      try { if (this.context && this.current() !== previousCount) this.context.destination.channelCount = previousCount; } catch { /* 设备离线时保留其当前安全值。 */ }
      this.failed?.(true);
      if (strict) throw error;
    } finally { this.publish(); }
  }

  private apply(): void {
    if (this.context && this.graphs.size) {
      const maximum = this.maximum();
      let cap = maximum ?? this.current();
      const requested = [...this.graphs].map((graph) => outputChannelCount(this.config.layout, graph.channels));
      const destinationChannels = Math.max(...requested.map((count) => supportedOutputChannels(count, cap)));
      try {
        this.context.destination.channelInterpretation = 'discrete';
        if (this.current() !== destinationChannels) this.context.destination.channelCount = destinationChannels;
        // 有些设备忽略 setter；始终以实际接受的数量为上限。
        cap = Math.min(cap, this.current());
      } catch { cap = Math.min(cap, this.current()); }
      for (const graph of this.graphs) {
        graph.setOutput(this.config, supportedOutputChannels(outputChannelCount(this.config.layout, graph.channels), cap));
      }
    }
  }

  private status(): AudioOutputStatus {
    const graph = [...this.graphs].at(-1);
    const maximum = this.maximum();
    const source = graph?.channels ?? null;
    const output = graph?.outputChannels ?? null;
    const requested = this.config.layout === 'source' ? source : outputChannelCount(this.config.layout, source ?? 2);
    return {
      supported: this.supported(), maxChannels: maximum, sourceChannels: source, outputChannels: output,
      limited: requested !== null && (output !== null ? output < requested : maximum !== null && requested > maximum),
    };
  }

  private publish(): void {
    const status = this.status();
    const key = JSON.stringify(status);
    if (key !== this.previous) { this.previous = key; this.changed?.(status); }
  }

  dispose(): void {
    this.unbind(); this.context = undefined; this.graphs.clear(); this.publish();
  }
}
