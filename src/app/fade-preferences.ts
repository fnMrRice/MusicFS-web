import { defaultFadeSettings, normalizeFadeSettings, type FadeSettings } from "../player/playback-transitions";

interface SavedFadePreferences {
  fades?: Partial<FadeSettings>;
  trackFadeEnabled?: boolean;
  seekFadeEnabled?: boolean;
  fadeEnabled?: boolean;
  fadeDurationMs?: number;
}

export function loadFadePreferences(saved: SavedFadePreferences | null): FadeSettings {
  if (saved?.fades && typeof saved.fades === "object") return normalizeFadeSettings(saved.fades);

  // 最早的 fadeEnabled 只控制切歌。合并开关后，用 0 保留单个场景的关闭状态。
  const track = typeof saved?.trackFadeEnabled === "boolean" ? saved.trackFadeEnabled : saved?.fadeEnabled !== false;
  const seek = saved?.seekFadeEnabled !== false;
  const enabled = track || seek;
  const oldMs = saved?.fadeDurationMs;
  const duration = typeof oldMs === "number" && Number.isFinite(oldMs)
    ? Math.min(2000, Math.max(100, Math.round(oldMs))) : defaultFadeSettings.trackMs;
  return {
    enabled,
    trackMs: track || !enabled ? duration : 0,
    seekMs: seek || !enabled ? duration : 0,
    pauseMs: defaultFadeSettings.pauseMs,
  };
}
