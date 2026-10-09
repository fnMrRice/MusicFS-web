import { ApiError, errorMessage } from '../api/client';
import type { PlaybackApi } from '../api/playback';
import type { Capabilities, Playback, Preferences, SourceTrack } from '../api/types';
import type { AudioFactory, AudioPort, MediaObservation } from './audio-adapter';
import { initialState } from './state';

export class PlayerController {
  state = initialState();
  onChange: (() => void) | null = null;
  private generation = 0;
  private controller: AbortController | null = null;
  private audio: AudioPort | null = null;
  constructor(private api: Pick<PlaybackApi, 'create' | 'close' | 'control'>, private createAudio: AudioFactory, private capabilities: Capabilities) {}
  async select(track: SourceTrack, preferences: Preferences = { forceProcessing: false, gainDb: 0 }): Promise<void> {
    this.stop(); const generation = this.generation;
    this.state = { ...initialState(), track, phase: 'resolving', wantsPlay: true }; this.emit();
    this.controller = new AbortController();
    try {
      const playback = await this.api.create(track.sourceTrackId, this.capabilities, preferences, crypto.randomUUID(), this.controller.signal);
      if (generation !== this.generation) { void this.api.close(playback.sessionId).catch(() => {}); return; }
      this.attach(playback, generation);
    } catch (error) { if (generation === this.generation) this.fail(errorMessage(error)); }
  }
  stop(): void {
    ++this.generation; this.controller?.abort(); this.audio?.destroy(); this.audio = null;
    if (this.state.playback) void this.api.close(this.state.playback.sessionId).catch(() => {});
    this.state = initialState(); this.emit();
  }
  private attach(playback: Playback, generation: number): void {
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
      this.state.phase = 'paused'; this.state.wantsPlay = false;
      this.state.message = '请点击音频控件中的播放按钮。'; this.emit();
    });
    else { this.state.phase = 'paused'; this.emit(); }
  }
  private observe(event: MediaObservation): void {
    this.state.positionMs = (this.state.playback?.positionOriginMs ?? 0) + event.seconds * 1000;
    switch (event.type) {
      case 'playing': this.state.phase = 'playing'; this.state.wantsPlay = true; this.state.message = null; break;
      case 'pause': if (this.state.phase !== 'ended') { this.state.phase = 'paused'; this.state.wantsPlay = false; } break;
      case 'waiting': case 'stalled': if (this.state.wantsPlay) this.state.phase = 'buffering'; break;
      case 'seeking': this.state.phase = 'seeking'; break;
      case 'seeked': this.state.phase = event.paused ? 'paused' : 'loading'; break;
      case 'ended': this.state.phase = 'ended'; this.state.wantsPlay = false; break;
      case 'error': this.fail(`音频读取或解码失败（${event.errorCode ?? '未知'}），请重新播放。`); return;
    }
    this.emit();
  }
  seek(positionMs: number): void {
    if (!Number.isFinite(positionMs) || !this.audio) return;
    if (this.state.playback?.seekMode !== 'byteRange') { this.fail(errorMessage(new ApiError('SEEK_UNSUPPORTED', 'Seek not available'))); return; }
    this.audio.seek(positionMs / 1000);
  }
  private fail(message: string): void { this.state.phase = 'error'; this.state.message = message; this.emit(); }
  private emit(): void { this.onChange?.(); }
}
