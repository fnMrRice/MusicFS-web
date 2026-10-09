import { ApiError, errorMessage } from '../api/client';
import type { PlaybackApi } from '../api/playback';
import type { Capabilities, Playback, Preferences, SourceTrack } from '../api/types';
import type { AudioFactory, AudioPort, MediaObservation } from './audio-adapter';
import { initialState } from './state';
import { ControlQueue, isUncertain } from './control-queue';
import { RecoveryBudget } from './recovery';
import { trackPosition, seekAllowed } from './timeline';

export class PlayerController {
  state = initialState();
  onChange: (() => void) | null = null;
  private generation = 0;
  private controller: AbortController | null = null;
  private audio: AudioPort | null = null;
  private queue: ControlQueue | null = null;
  private recovery = new RecoveryBudget();
  private bufferingTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private api: Pick<PlaybackApi, 'create' | 'close' | 'control'>, private createAudio: AudioFactory, private capabilities: Capabilities) {}
  async select(track: SourceTrack, preferences: Preferences = { forceProcessing: false, gainDb: 0 }): Promise<void> {
    this.stop(); const generation = this.generation;
    this.state = { ...initialState(), track, phase: 'resolving', wantsPlay: true }; this.emit();
    this.controller = new AbortController(); this.recovery = new RecoveryBudget();
    try {
      const key = crypto.randomUUID(); let playback: Playback;
      try { playback = await this.api.create(track.sourceTrackId, this.capabilities, preferences, key, this.controller.signal); }
      catch (error) {
        if (generation !== this.generation || !isUncertain(error)) throw error;
        playback = await this.api.create(track.sourceTrackId, this.capabilities, preferences, key, this.controller.signal);
      }
      if (generation !== this.generation) { void this.api.close(playback.sessionId).catch(() => {}); return; }
      this.queue = new ControlQueue(playback, (current, intent, key, signal) => this.api.control(current.sessionId,
        intent.kind, current.attemptId, intent.positionMs, key, intent.observedError, signal), (current, apply) => {
          if (generation !== this.generation) return;
          this.state.playback = current;
          if (apply) this.attach(current, generation);
        }, (error) => { if (generation === this.generation) this.fail(errorMessage(error)); });
      this.attach(playback, generation);
    } catch (error) { if (generation === this.generation) this.fail(errorMessage(error)); }
  }
  stop(): void {
    ++this.generation; this.controller?.abort(); this.queue?.dispose(); this.queue = null;
    this.clearBufferingTimer(); this.audio?.destroy(); this.audio = null;
    if (this.state.playback) void this.api.close(this.state.playback.sessionId).catch(() => {});
    this.state = initialState(); this.emit();
  }
  private attach(playback: Playback, generation: number): void {
    if (playback.resumeDecision !== 'continue') {
      this.state.playback = playback;
      this.fail(playback.resumeDecision === 'restartRequired' ? '无法确认续播位置，请选择从头播放或停止。' : '此来源暂不可播放，请停止或选择其他歌曲。'); return;
    }
    this.audio?.destroy(); this.state.playback = playback; this.state.phase = 'loading'; this.state.message = null;
    this.state.positionMs = playback.positionOriginMs;
    this.audio = this.createAudio(playback.streamUrl, (event) => {
      if (generation !== this.generation || this.state.playback?.attemptId !== playback.attemptId) return;
      this.observe(event);
    });
    this.emit();
    if (this.state.wantsPlay) void this.audio.play().catch((error: unknown) => {
      if (generation !== this.generation || this.state.playback?.attemptId !== playback.attemptId) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.state.phase = 'paused'; this.state.wantsPlay = false;
        this.state.message = '请点击音频控件中的播放按钮。'; this.emit();
      } else this.recover('PLAY_REJECTED');
    });
    else { this.state.phase = 'paused'; this.emit(); }
  }
  private observe(event: MediaObservation): void {
    if (this.state.playback) this.state.positionMs = trackPosition(this.state.playback, event.seconds);
    switch (event.type) {
      case 'playing': this.clearBufferingTimer(); this.state.phase = 'playing'; this.state.wantsPlay = true; this.state.message = null; break;
      case 'pause': this.clearBufferingTimer(); if (this.state.phase !== 'ended') { this.state.phase = 'paused'; this.state.wantsPlay = false; } break;
      case 'waiting': case 'stalled':
        if (this.state.wantsPlay) {
          this.state.phase = 'buffering';
          if (!this.bufferingTimer) this.bufferingTimer = setTimeout(() => this.recover('BUFFERING_TIMEOUT'), 10_000);
        }
        break;
      case 'seeking': this.state.phase = 'seeking'; break;
      case 'seeked': this.state.phase = event.paused ? 'paused' : 'loading'; break;
      case 'ended': this.clearBufferingTimer(); this.state.phase = 'ended'; this.state.wantsPlay = false; break;
      case 'error': this.recover(`MEDIA_ERROR_${event.errorCode ?? 'UNKNOWN'}`); return;
    }
    this.emit();
  }
  private recover(code: string): void {
    this.clearBufferingTimer(); const playback = this.state.playback;
    if (!playback || !this.queue || ['recovering', 'seeking'].includes(this.state.phase)) return;
    if (!this.recovery.allow(playback.attemptId)) { this.fail('自动恢复已用尽，请重新播放。'); return; }
    this.state.phase = 'recovering'; this.audio?.destroy(); this.audio = null; this.emit();
    this.queue.recover(this.state.positionMs, { code, message: 'Browser observed media failure', outputProfile: playback.outputProfile });
  }
  private clearBufferingTimer(): void { if (this.bufferingTimer) clearTimeout(this.bufferingTimer); this.bufferingTimer = null; }
  seek(positionMs: number): void {
    const playback = this.state.playback;
    if (!playback || !seekAllowed(playback, positionMs)) {
      this.state.message = '请输入当前曲目可定位范围内的有效位置。'; this.emit(); return;
    }
    if (playback.seekMode === 'timeRestart' && this.queue) {
      this.clearBufferingTimer(); this.audio?.destroy(); this.audio = null;
      this.state.phase = 'seeking'; this.state.message = null; this.emit(); this.queue.seek(positionMs); return;
    }
    if (!this.audio) return;
    if (playback?.seekMode !== 'byteRange') { this.fail(errorMessage(new ApiError('SEEK_UNSUPPORTED', 'Seek not available'))); return; }
    const range = playback.seekableRange; const seconds = (positionMs - playback.positionOriginMs) / 1000;
    if (!range || positionMs < range.startMs || positionMs > range.endMs
      || !this.audio.seekable.some((r) => seconds >= r.start && seconds <= r.end)) {
      this.state.message = '目标尚不在当前可定位范围内，请等待加载或选择其他位置。'; this.emit(); return;
    }
    this.audio.seek(seconds);
  }
  private fail(message: string): void { this.clearBufferingTimer(); this.audio?.destroy(); this.audio = null; this.state.phase = 'error'; this.state.message = message; this.emit(); }
  private emit(): void { this.onChange?.(); }
}
