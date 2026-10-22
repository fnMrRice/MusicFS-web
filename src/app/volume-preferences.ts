interface SavedVolume { volume?: unknown; lastVolume?: unknown }

function validVolume(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function volumePreferences(saved?: SavedVolume | null): { volume: number; lastVolume: number } {
  const volume = validVolume(saved?.volume) ? saved.volume : 0.8;
  const lastVolume = volume > 0 ? volume
    : validVolume(saved?.lastVolume) && saved.lastVolume > 0 ? saved.lastVolume : 0.8;
  return { volume, lastVolume };
}
