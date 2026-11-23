import type { AudioPort } from "./audio-adapter";

type Transition = "track" | "seek";

export class PlaybackTransitions {
  private enabled = { track: true, seek: true };
  private durationMs = 300;
  private active: Transition | null = null;
  private incoming = false;
  private endingAttempt: string | null = null;

  configure(track: boolean, seek: boolean, durationMs: number, audio: AudioPort | null): void {
    this.enabled = { track, seek };
    this.durationMs = Number.isFinite(durationMs) ? Math.max(100, Math.min(2000, durationMs)) : 300;
    if (this.active && !this.enabled[this.active]) this.reset(audio);
  }

  fadeOut(kind: Transition, audio: AudioPort | null): Promise<void> | undefined {
    if (!this.enabled[kind] || !audio?.fadeOut) return;
    this.active = kind;
    this.incoming = false;
    return audio.fadeOut(this.durationMs);
  }

  prepareIncoming(kind: Transition): void {
    this.active = this.enabled[kind] ? kind : null;
    this.incoming = this.active !== null;
    this.endingAttempt = null;
  }

  fadeIn(audio: AudioPort): void {
    if (this.incoming) audio.fadeIn?.(this.durationMs);
    this.incoming = false;
  }

  fadeEnding(audio: AudioPort | null, remaining: number, attempt: string): void {
    if (this.enabled.track && remaining > 0 && remaining <= this.durationMs && this.endingAttempt !== attempt) {
      this.endingAttempt = attempt;
      this.active = "track";
      void audio?.fadeOut?.(remaining);
    }
  }

  reset(audio?: AudioPort | null): void {
    this.active = null;
    this.incoming = false;
    this.endingAttempt = null;
    audio?.cancelFade?.();
  }
}
