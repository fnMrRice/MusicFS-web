const SAMPLE_INTERVAL_MS = 100;
const TARGET_DB = -18;
const SILENCE_DB = -50;
const MIN_GAIN_DB = -24;
const MAX_GAIN_DB = 6;
const PEAK_CEILING = 0.95;

/** 根据效果链后的采样 RMS 调整音量；不是 LUFS 测量或真峰值限制器。 */
export class AutoVolume {
  readonly input: AnalyserNode;
  readonly output: GainNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly probes: AnalyserNode[] = [];
  private readonly samples = new Float32Array(2048);
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled = false;
  private playing = false;
  private disposed = false;
  private gainDB = 0;
  private audibleSeconds = 0;
  private previousTime = 0;

  constructor(private readonly context: BaseAudioContext, channels = 2) {
    this.input = context.createAnalyser();
    this.input.fftSize = this.samples.length;
    this.input.smoothingTimeConstant = 0;
    this.output = context.createGain();
    this.input.connect(this.output);
    const count = Number.isFinite(channels) ? Math.min(8, Math.max(1, Math.floor(channels))) : 2;
    this.splitter = context.createChannelSplitter(count);
    this.input.connect(this.splitter);
    // 旁路逐声道测量，避免反相抵消或 LFE 在扬声器混音时被忽略；主路径保持原声道。
    for (let channel = 0; channel < count; channel++) {
      const probe = context.createAnalyser();
      probe.fftSize = this.samples.length;
      probe.smoothingTimeConstant = 0;
      probe.channelCount = 1;
      probe.channelCountMode = 'explicit';
      probe.channelInterpretation = 'discrete';
      this.splitter.connect(probe, channel);
      this.probes.push(probe);
    }
    this.setGain(0, true);
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    this.clearPolling();
    this.audibleSeconds = 0;
    if (!enabled) this.setGain(0);
    this.ensurePolling();
  }

  start(): void {
    if (this.disposed) return;
    this.playing = true;
    this.ensurePolling();
  }

  stop(): void {
    this.playing = false;
    this.clearPolling();
    this.audibleSeconds = 0;
  }

  /** 换曲清除上一首的估计与增益，等待新媒体的真实 playing 事件。 */
  reset(): void {
    if (this.disposed) return;
    this.stop();
    this.setGain(0, true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.input.disconnect();
    this.splitter.disconnect();
    this.probes.forEach((probe) => probe.disconnect());
    this.output.disconnect();
  }

  private clearPolling(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private ensurePolling(): void {
    if (!this.enabled || !this.playing || this.timer !== null) return;
    this.previousTime = this.time();
    this.timer = setInterval(() => this.measure(), SAMPLE_INTERVAL_MS);
  }

  private time(): number {
    return Number.isFinite(this.context.currentTime) ? this.context.currentTime : 0;
  }

  private measure(): void {
    const now = this.time();
    // 后台定时器恢复时限制单次提升，避免累计延迟造成突然放大。
    const elapsed = Math.min(0.25, Math.max(0, now - this.previousTime));
    this.previousTime = now;
    if (this.context.state !== 'running' || elapsed === 0) return;
    let maxSquares = 0;
    let peak = 0;
    try {
      for (const probe of this.probes) {
        probe.getFloatTimeDomainData(this.samples);
        let squares = 0;
        for (const sample of this.samples) {
          if (!Number.isFinite(sample)) { this.invalidMeasurement(); return; }
          squares += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
        }
        maxSquares = Math.max(maxSquares, squares);
      }
    } catch {
      this.invalidMeasurement();
      return;
    }
    // 取最响声道，空声道不稀释结果；所有声道共用一个增益以保留声像。
    const rms = Math.sqrt(maxSquares / this.samples.length);
    if (rms < 10 ** (SILENCE_DB / 20)) {
      // 静音与底噪不参与追增益，重新出现信号后再次积累观察时间。
      this.audibleSeconds = 0;
      return;
    }
    this.audibleSeconds += elapsed;
    const peakLimit = 20 * Math.log10(PEAK_CEILING / peak);
    const wanted = Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, TARGET_DB - 20 * Math.log10(rms), peakLimit));
    if (wanted > this.gainDB && this.audibleSeconds < 0.4) return;
    const seconds = wanted < this.gainDB ? 0.04 : 2;
    const smoothed = this.gainDB + (wanted - this.gainDB) * (1 - Math.exp(-elapsed / seconds));
    // 实测峰值约束优先于提升平滑；输出仍有短时间包络，并非无延迟限幅。
    const next = Math.max(MIN_GAIN_DB, Math.min(smoothed, peakLimit));
    if (Math.abs(next - this.gainDB) > 0.0001) this.setGain(next);
  }

  private invalidMeasurement(): void {
    this.audibleSeconds = 0;
    if (this.gainDB > 0) this.setGain(0);
  }

  private setGain(db: number, immediate = false): void {
    const now = this.time();
    const param = this.output.gain;
    const gain = 10 ** (db / 20);
    if (immediate) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(gain, now);
    } else {
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
      else {
        const current = Number.isFinite(param.value) ? param.value : 1;
        param.cancelScheduledValues(now);
        param.setValueAtTime(current, now);
      }
      param.setTargetAtTime(gain, now, db < this.gainDB ? 0.02 : 0.08);
    }
    this.gainDB = db;
  }
}
