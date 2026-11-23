import type { AudioPort } from "./audio-adapter";

export interface FadeSettings {
  enabled: boolean;
  trackMs: number;
  pauseMs: number;
  seekMs: number;
}

export const defaultFadeSettings: FadeSettings = { enabled: true, trackMs: 300, pauseMs: 300, seekMs: 300 };

export function normalizeFadeSettings(settings: Partial<FadeSettings>): FadeSettings {
  const duration = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(2000, Math.round(value))) : fallback;
  return {
    enabled: typeof settings.enabled === "boolean" ? settings.enabled : defaultFadeSettings.enabled,
    trackMs: duration(settings.trackMs, defaultFadeSettings.trackMs),
    pauseMs: duration(settings.pauseMs, defaultFadeSettings.pauseMs),
    seekMs: duration(settings.seekMs, defaultFadeSettings.seekMs),
  };
}

type Transition = "trackMs" | "seekMs" | "pauseMs";

export class PlaybackTransitions {
  private settings = defaultFadeSettings;
  private active: Transition | null = null;
  private incoming = false;
  private endingAttempt: string | null = null;
  private pendingPause: Promise<void> | undefined;
  userPaused = false;

  get pausing(): boolean { return !!this.pendingPause; }

  configure(settings: FadeSettings, audio: AudioPort | null): void {
    this.settings = normalizeFadeSettings(settings);
    if (this.active && !this.duration(this.active)) this.reset(audio);
  }

  private duration(kind: Transition): number {
    return this.settings.enabled ? this.settings[kind] : 0;
  }

  fadeOut(kind: Transition, audio: AudioPort | null): Promise<void> | undefined {
    const duration = this.duration(kind);
    if (!duration || !audio?.fadeOut) return;
    this.active = kind;
    this.incoming = false;
    return audio.fadeOut(duration);
  }

  prepareIncoming(kind: Transition): void {
    this.active = this.duration(kind) ? kind : null;
    this.incoming = this.active !== null;
    this.endingAttempt = null;
  }

  fadeIn(audio: AudioPort): void {
    if (this.incoming && this.active) audio.fadeIn?.(this.duration(this.active));
    this.incoming = false;
  }

  fadeEnding(audio: AudioPort | null, remaining: number, attempt: string): void {
    if (remaining > 0 && remaining <= this.duration("trackMs") && this.endingAttempt !== attempt) {
      this.endingAttempt = attempt;
      this.active = "trackMs";
      void audio?.fadeOut?.(remaining);
    }
  }

  pause(audio: AudioPort | null, audible: boolean): void {
    this.userPaused = true;
    const pending = audible ? this.fadeOut("pauseMs", audio) : undefined;
    this.pendingPause = pending;
    if (pending) {
      void pending.then(() => {
        if (this.pendingPause === pending) this.finishPause(audio);
      });
    } else audio?.pause();
  }

  private finishPause(audio: AudioPort | null): void {
    if (this.pendingPause) {
      this.pendingPause = undefined;
      audio?.pause();
    }
  }

  resume(audio: AudioPort | null): boolean {
    const reversing = !!this.pendingPause && !!audio && !audio.ended;
    this.pendingPause = undefined;
    this.userPaused = false;
    this.prepareIncoming("pauseMs");
    if (audio) {
      if (reversing) {
        // 暂停尚未真正生效，从淡出途中的音量平滑回升。
        audio.fadeIn?.(this.duration("pauseMs"), true);
        this.incoming = false;
      } else if (this.incoming) this.fadeIn(audio);
      else audio.cancelFade?.();
    }
    return reversing;
  }

  reset(audio: AudioPort | null): void {
    this.finishPause(audio);
    this.active = null;
    this.incoming = false;
    this.endingAttempt = null;
    audio?.cancelFade?.();
  }

  stop(): void {
    this.pendingPause = undefined;
    this.userPaused = false;
    this.reset(null);
  }
}
