import type { Playback } from '../api/types';
export function trackPosition(playback: Playback, seconds: number): number {
  return playback.positionOriginMs + Math.max(0, seconds) * 1000;
}
export function seekAllowed(playback: Playback, positionMs: number): boolean {
  const range = playback.seekableRange;
  return playback.seekMode !== 'none' && Number.isFinite(positionMs) && range !== null
    && positionMs >= range.startMs && positionMs <= range.endMs;
}
