import { defaultFadeSettings, normalizeFadeSettings, type FadeSettings } from "../player/playback-transitions";
import { Store } from "./store";
import { loadRecommendationLayout, saveRecommendationLayout, type RecommendationLayout } from "./recommendation-order";
import { loadVolumePreferences, saveVolumePreferences, volumePreferences } from "./volume-preferences";

export interface PreferencesState extends RecommendationLayout {
  theme: "dark" | "light" | "system";
  accent: "default" | "miku" | "tianyi";
  albumView: "cards" | "list";
  volume: number;
  lastVolume: number;
  lyricsPinned: boolean;
  queuePinned: boolean;
  mine: boolean;
  playlists: boolean;
  playlistFolders: Record<string, boolean>;
  works: boolean;
  processing: boolean;
  fades: FadeSettings;
  autoVolume: boolean;
}
const defaults: PreferencesState = {
  theme: "system",
  accent: "default",
  albumView: "cards",
  volume: 0.8,
  lastVolume: 0.8,
  lyricsPinned: false,
  queuePinned: false,
  mine: true,
  playlists: true,
  playlistFolders: {},
  collapsedRecommendations: [],
  recommendationOrder: [],
  works: false,
  processing: false,
  fades: defaultFadeSettings,
  autoVolume: false,
};
export class PreferencesStore extends Store<PreferencesState> {
  private key: string | null = null;
  private user: string | null = null;

  constructor() { super({ ...defaults }); }

  load(instance: string, user: string): void {
    this.user = user;
    this.key = `musicfs:${encodeURIComponent(instance)}:${encodeURIComponent(user)}:preferences`;
    let saved: Partial<PreferencesState> = {};
    try {
      saved = JSON.parse(localStorage.getItem(this.key) ?? "{}");
    } catch {
      /* 存储不可用时使用默认偏好。 */
    }
    this.set({
      theme: saved?.theme === "dark" || saved?.theme === "light" ? saved.theme : defaults.theme,
      accent: saved?.accent === "miku" || saved?.accent === "tianyi" ? saved.accent : defaults.accent,
      albumView: saved?.albumView === "list" ? "list" : defaults.albumView,
      ...loadVolumePreferences(),
      lyricsPinned: saved?.lyricsPinned === true,
      queuePinned: saved?.queuePinned === true,
      ...loadRecommendationLayout(user),
      mine: saved?.mine !== false,
      playlists: saved?.playlists !== false,
      playlistFolders: saved?.playlistFolders && typeof saved.playlistFolders === "object" && !Array.isArray(saved.playlistFolders)
        ? saved.playlistFolders : {},
      works: saved?.works === true,
      processing: saved?.processing === true,
      fades: normalizeFadeSettings(saved?.fades ?? {}),
      autoVolume: saved?.autoVolume === true,
    });
  }

  update(patch: Partial<PreferencesState>): void {
    const volume = volumePreferences({ ...this.value, ...patch });
    if (patch.volume !== undefined && volume.volume > 0) volume.lastVolume = volume.volume;
    this.set({ ...this.value, ...patch, ...volume });
    if (patch.volume !== undefined || patch.lastVolume !== undefined) saveVolumePreferences(volume);
    if (!this.key || !this.user) return;
    if (patch.collapsedRecommendations !== undefined || patch.recommendationOrder !== undefined)
      saveRecommendationLayout(this.user, patch);
    const { volume: _volume, lastVolume, collapsedRecommendations, recommendationOrder, ...general } = this.value;
    if (!Object.keys(patch).some(key => Object.hasOwn(general, key))) return;
    try {
      localStorage.setItem(this.key, JSON.stringify(general));
    } catch { /* 本次修改仍在当前页面生效。 */ }
  }

  reset(): void {
    this.key = null;
    this.user = null;
    this.set({ ...defaults });
  }
}
