import { ApiError } from "../api/client";
import type { AuthSession, Playback } from "../api/types";

type ActivePlayback = Pick<Playback, "sessionId" | "expiresAt">;

function halfLifetime(expiresAt: string): number {
  const remaining = Date.parse(expiresAt) - Date.now();
  // 服务端最短登录期限为一分钟。无效时间使用保守间隔，远期截止时间避免浏览器定时器溢出。
  return Number.isFinite(remaining) ? Math.max(1000, Math.min(remaining / 2, 24 * 3600_000)) : 15_000;
}

export class PlaybackSessionRenewal {
  private loginDelay = 0;
  private nextLogin = 0;
  private nextPlayback = 0;
  private playback: ActivePlayback | null = null;
  private playing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;

  constructor(private renew: (sessionId: string, signal: AbortSignal) => Promise<{ expiresAt: string }>) {}

  setSession(session: AuthSession | null): void {
    this.cancel();
    this.playback = null;
    this.playing = false;
    this.loginDelay = session ? halfLifetime(session.expiresAt) : 0;
    this.nextLogin = Date.now() + this.loginDelay;
  }

  activity(startedAt = Date.now()): void {
    // 普通 HTTP 请求只给登录续期，不能延后正在播放的媒体资源的保活。
    this.nextLogin = Math.max(this.nextLogin, startedAt + this.loginDelay);
  }

  setPlayback(playback: ActivePlayback | null, playing: boolean): void {
    const changed = playback?.sessionId !== this.playback?.sessionId || playback?.expiresAt !== this.playback?.expiresAt;
    if (!changed && playing === this.playing) return;
    this.cancel();
    this.playback = playback;
    this.playing = playing;
    if (changed && playback) this.nextPlayback = Date.now() + halfLifetime(playback.expiresAt);
    this.schedule();
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.request?.abort();
    this.request = null;
  }

  private schedule(): void {
    if (!this.playing || !this.playback || !this.loginDelay) return;
    const delay = Math.min(this.nextLogin, this.nextPlayback) - Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      // 等待期间可能已有其他已认证请求给登录续期。
      if (Math.min(this.nextLogin, this.nextPlayback) > Date.now()) this.schedule();
      else void this.refresh();
    }, Math.max(0, delay));
  }

  private async refresh(): Promise<void> {
    const playback = this.playback;
    if (!playback) return;
    const request = new AbortController();
    this.request = request;
    try {
      const result = await this.renew(playback.sessionId, request.signal);
      if (request.signal.aborted) return;
      this.activity();
      this.nextPlayback = Date.now() + halfLifetime(result.expiresAt);
    } catch (error) {
      if (request.signal.aborted || error instanceof ApiError && [401, 403, 404, 410].includes(error.status)) return;
      const retryAt = Date.now() + Math.min(this.loginDelay, 5000);
      this.nextPlayback = retryAt;
      this.nextLogin = Math.max(this.nextLogin, retryAt);
    } finally {
      if (this.request === request) this.request = null;
    }
    this.schedule();
  }
}
