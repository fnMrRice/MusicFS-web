import { LocalDSPGraph } from './graph';
import { normalizeLocalDSP } from './model';
import type { LocalDSPConfig } from './model';
import { AudioOutputController } from './output-controller';
import type { AudioOutputConfig, AudioOutputStatus } from './output';

export interface LocalDSPAttachment {
  resume(): Promise<void>;
  pause(): void;
  reset(holdSilence?: boolean, sourceChannels?: number): void;
  fadeOut(durationMs: number): Promise<void>;
  prepareFadeIn(): void;
  fadeIn(durationMs: number, fromCurrent?: boolean): void;
  setVolume(volume: number): void;
  detach(): void;
}

interface ActiveAttachment extends LocalDSPAttachment {
  graph: LocalDSPGraph;
}

function audioContextConstructor(): typeof AudioContext | undefined {
  return globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export class LocalDSPEngine {
  private config: LocalDSPConfig;
  private context: AudioContext | undefined;
  private attachments = new Map<HTMLMediaElement, ActiveAttachment>();
  private sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private error: string | null = null;
  private graphError: string | null = null;
  private resumeError: string | null = null;
  private outputError: string | null = null;
  private cancelResumes = new Set<() => void>();
  private autoVolume = false;
  private readonly output: AudioOutputController;

  constructor(config: LocalDSPConfig, private readonly onError?: (message: string | null) => void, onOutputStatus?: (status: AudioOutputStatus) => void) {
    this.config = normalizeLocalDSP(config);
    this.output = new AudioOutputController(LocalDSPEngine.supported, onOutputStatus, (failed) => {
      this.outputError = failed ? '本地音频输出更新失败，请重新播放。' : null;
      this.report(this.graphError ?? this.outputError ?? this.resumeError);
    });
  }

  static supported(): boolean { return typeof audioContextConstructor() === 'function'; }

  private report(message: string | null): void {
    if (this.error === message) return;
    this.error = message;
    this.onError?.(message);
  }

  private reportGraph(message: string | null): void {
    this.graphError = message;
    this.report(this.graphError ?? this.outputError ?? this.resumeError);
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context && this.context.state !== 'closed') return this.context;
    const Context = audioContextConstructor();
    if (!Context) {
      this.reportGraph('此浏览器不支持本地 DSP，音频将直接播放。');
      return undefined;
    }
    this.context = new Context();
    this.output.bind(this.context);
    return this.context;
  }

  setConfig(config: LocalDSPConfig): void {
    this.config = normalizeLocalDSP(config);
    try {
      for (const attachment of this.attachments.values()) attachment.graph.update(this.config);
      if (this.attachments.size) this.reportGraph(null);
    } catch {
      this.reportGraph('本地 DSP 更新失败，请关闭效果或重新播放。');
    }
  }

  setAutoVolume(enabled: boolean): void {
    this.autoVolume = enabled;
    for (const attachment of this.attachments.values()) attachment.graph.setAutoVolume(enabled);
  }

  setOutput(config: AudioOutputConfig): void {
    this.output.setConfig(config);
  }

  inspectOutput(): AudioOutputStatus {
    try { this.ensureContext(); } catch { /* 探测失败时仍可使用原生音频播放。 */ }
    return this.output.inspect();
  }

  // 必须在点击处理函数中同步发起 resume，不能等播放接口返回后才解锁。
  unlock(): void {
    try {
      const context = this.ensureContext();
      if (context) void this.resumeContext(context).catch(() => {});
    } catch {
      this.reportGraph('无法启动本地音频处理，音频将尝试直接播放。');
    }
  }

  private async resumeContext(context: AudioContext): Promise<void> {
    try {
      if (context.state !== 'running') {
        // 某些自动播放策略会让 resume 永久等待，限定等待时间后交回播放器重试。
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancel = () => {};
        const timeout = new Promise<void>((resolve, reject) => {
          cancel = () => {
            clearTimeout(timer);
            reject(new DOMException('Audio context was disposed', 'AbortError'));
          };
          timer = setTimeout(() => {
            if (context.state === 'running') resolve();
            else reject(new DOMException('Audio context resume timed out', 'NotAllowedError'));
          }, 1500);
        });
        this.cancelResumes.add(cancel);
        try { await Promise.race([context.resume(), timeout]); }
        finally { clearTimeout(timer); this.cancelResumes.delete(cancel); }
      }
      if (context.state !== 'running') throw new DOMException('Audio context requires a user gesture', 'NotAllowedError');
      if (this.context === context) {
        this.resumeError = null;
        this.report(this.graphError ?? this.outputError);
      }
    } catch (error) {
      if (this.context === context) {
        this.resumeError = '本地音频处理尚未启动，请点击播放重试。';
        this.report(this.graphError ?? this.outputError ?? this.resumeError);
      }
      throw error;
    }
  }

  attach(audio: HTMLMediaElement, channels = 2): LocalDSPAttachment {
    this.attachments.get(audio)?.detach();
    let context: AudioContext | undefined;
    let graph: LocalDSPGraph | undefined;
    let source: MediaElementAudioSourceNode | undefined;
    try {
      context = this.ensureContext();
      if (context) {
        const count = Number.isInteger(channels) && channels >= 1 && channels <= 8 ? channels : 2;
        graph = new LocalDSPGraph(context, this.config, count);
        graph.setAutoVolume(this.autoVolume);
        this.output.add(graph);
        source = this.sources.get(audio) ?? context.createMediaElementSource(audio);
        this.sources.set(audio, source);
        source.connect(graph.input);
        const attachedSource = source;
        let attachedGraph = graph;
        const attachedContext = context;
        let detached = false;
        let paused = false;
        let started = false;
        let volume = 1;
        let playIntent = 0;
        let fadeTimer: ReturnType<typeof setTimeout> | undefined;
        let finishFade: (() => void) | undefined;
        const cancelFade = (restore = true) => {
          clearTimeout(fadeTimer);
          fadeTimer = undefined;
          const finish = finishFade;
          finishFade = undefined;
          if (restore) attachedGraph.cancelFade();
          finish?.();
        };
        const attachment: ActiveAttachment = {
          graph: attachedGraph,
          resume: async () => {
            if (detached) return;
            const intent = ++playIntent;
            await this.resumeContext(attachedContext);
            if (!detached && intent === playIntent) { paused = false; started = true; attachedGraph.setPaused(false); }
          },
          pause: () => {
            if (!detached) { playIntent++; paused = true; started = false; attachedGraph.setPaused(true); cancelFade(); }
          },
          reset: (holdSilence = false, sourceChannels?: number) => {
            if (detached || (sourceChannels !== undefined && (!Number.isInteger(sourceChannels) ||
                sourceChannels < 1 || sourceChannels > 8 || sourceChannels === attachedGraph.channels))) return;
            cancelFade(!holdSilence);
            let replacement: LocalDSPGraph | undefined;
            try {
              replacement = new LocalDSPGraph(attachedContext, this.config, sourceChannels ?? attachedGraph.channels);
              if (holdSilence) replacement.fadeTo(0, 0);
              replacement.setAutoVolume(this.autoVolume);
              this.output.add(replacement);
              replacement.setVolume(volume);
              if (paused || started) replacement.setPaused(paused);
              attachedSource.disconnect();
              attachedSource.connect(replacement.input);
              attachedGraph.dispose();
              this.output.remove(attachedGraph);
              attachedGraph = replacement;
              attachment.graph = replacement;
              this.reportGraph(null);
            } catch {
              if (replacement) this.output.remove(replacement);
              replacement?.dispose();
              attachedSource.disconnect();
              attachedSource.connect(attachedGraph.input);
              this.reportGraph('本地 DSP 更新失败，请关闭效果或重新播放。');
            }
          },
          fadeOut: (durationMs) => {
            if (detached) return Promise.resolve();
            // 连续切歌或定位从当前增益继续，避免音量跳变。
            cancelFade(false);
            if (paused || attachedContext.state !== 'running') return Promise.resolve();
            const duration = attachedGraph.fadeTo(0, durationMs);
            if (duration === 0) return Promise.resolve();
            return new Promise<void>((resolve) => {
              finishFade = resolve;
              fadeTimer = setTimeout(() => {
                fadeTimer = undefined;
                finishFade = undefined;
                resolve();
              }, duration);
            });
          },
          fadeIn: (durationMs, fromCurrent = false) => {
            if (detached) return;
            cancelFade(false);
            if (fromCurrent) attachedGraph.fadeTo(1, durationMs);
            else attachedGraph.fadeIn(durationMs);
          },
          prepareFadeIn: () => {
            if (detached) return;
            cancelFade();
            attachedGraph.fadeTo(0, 0);
          },
          setVolume: (value) => { if (!detached) { volume = value; attachedGraph.setVolume(value); } },
          detach: () => {
            if (detached) return;
            detached = true;
            cancelFade();
            attachedSource.disconnect();
            attachedGraph.dispose();
            this.attachments.delete(audio);
            this.output.remove(attachedGraph);
          },
        };
        this.attachments.set(audio, attachment);
        this.reportGraph(null);
        return attachment;
      }
    } catch {
      if (graph) this.output.remove(graph);
      graph?.dispose();
      if (source) {
        source.disconnect();
        this.reportGraph('本地音频路由失败，请重新播放。');
        throw new Error('Local DSP audio routing failed');
      }
      this.reportGraph('本地 DSP 初始化失败，音频将尝试直接播放。');
    }
    // 未创建媒体源时，原生 audio 仍拥有声音输出能力。
    return {
      resume: () => Promise.resolve(),
      pause: () => {},
      reset: () => {},
      fadeOut: () => Promise.resolve(),
      prepareFadeIn: () => {},
      fadeIn: () => {},
      setVolume: (value) => { audio.volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1; },
      detach: () => {},
    };
  }

  dispose(): void {
    for (const attachment of [...this.attachments.values()]) attachment.detach();
    const context = this.context;
    this.context = undefined;
    this.output.dispose();
    this.sources = new WeakMap();
    for (const cancel of this.cancelResumes) cancel();
    this.cancelResumes.clear();
    this.graphError = null;
    this.resumeError = null;
    this.outputError = null;
    this.report(null);
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}
