interface SavedVolume { volume?: unknown; lastVolume?: unknown }
const storageKey = "musicfs:volume";

function validVolume(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function volumePreferences(saved?: SavedVolume | null): { volume: number; lastVolume: number } {
  const volume = validVolume(saved?.volume) ? saved.volume : 0.8;
  const lastVolume = volume > 0 ? volume
    : validVolume(saved?.lastVolume) && saved.lastVolume > 0 ? saved.lastVolume : 0.8;
  return { volume, lastVolume };
}

export function loadVolumePreferences(): { volume: number; lastVolume: number } {
  try {
    return volumePreferences(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
  } catch {
    return volumePreferences();
  }
}

export function saveVolumePreferences(value: { volume: number; lastVolume: number }): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // 本地存储不可用时，音量仍在当前页面生效。
  }
}
