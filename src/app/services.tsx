import { createContext, useContext, useSyncExternalStore } from "react";
import { ApiClient, ApiError, errorMessage } from "../api/client";
import { AuthApi } from "../api/auth";
import { LibraryApi } from "../api/library";
import { ContentApi, type Playlist } from "../api/content";
import { PlaybackApi } from "../api/playback";
import type {
  AuthSession,
  Ready,
  SourceTrack,
  Preferences,
} from "../api/types";
import { PlayerController } from "../player/controller";
import { PlaybackQueue, type PlaybackMode } from "../player/playback-queue";
import { audioFactory } from "../player/audio-adapter";
import { capabilities } from "../player/capabilities";
import { Store } from "./store";
import { LibraryState } from "../library/state";
import { CapabilityEvents } from "./capability-events";
import { capabilityResources } from "./capability-resources";
import { SourcePlaylistCatalog } from "./source-playlists";
import { ProfileApi } from "../api/profile";
import { PersonalProfileState } from "./personal-profile";
import { ScansApi } from "../api/scans";
import { LocalScanState } from "../library/local-scan-state";
import { LocalScans } from "../library/local-scans";
import { ConfigurationScans } from "../library/configuration-scans";
import type { PluginOperation } from "../api/directories";
import { LocalDSPSettingsStore } from "./local-dsp-settings";
import { AudioOutputSettingsStore } from "./audio-output-settings";
import { LocalDSPEngine } from "../player/dsp/engine";
import { MatchingApi } from "../api/matching";
import { MatchingDecisions } from "../library/matching-decisions";
import { volumePreferences } from "./volume-preferences";
import { RecordingCovers } from "./recording-covers";
import { FavoritesApi } from "../api/favorites";
import { FavoritesState } from "../library/favorites";

interface AuthState {
  session: AuthSession | null;
  ready: Ready | null;
  busy: boolean;
  error: string | null;
}
interface PreferencesState {
  theme: "dark" | "light" | "system";
  volume: number;
  lastVolume: number;
  lyricsPinned: boolean;
  queuePinned: boolean;
  mine: boolean;
  playlists: boolean;
  works: boolean;
  processing: boolean;
  fadeEnabled: boolean;
  fadeDurationMs: number;
  autoVolume: boolean;
}
const defaults: PreferencesState = {
  theme: "system",
  volume: 0.8,
  lastVolume: 0.8,
  lyricsPinned: false,
  queuePinned: false,
  mine: true,
  playlists: true,
  works: false,
  processing: false,
  fadeEnabled: false,
  fadeDurationMs: 300,
  autoVolume: false,
};
export class Services {
  client = new ApiClient();
  authApi = new AuthApi(this.client);
  profile = new PersonalProfileState(new ProfileApi(this.client));
  libraryApi = new LibraryApi(this.client);
  favorites = new FavoritesState(new FavoritesApi(this.client));
  matchingDecisions = new MatchingDecisions(new MatchingApi(this.client), () => this.matchingChanged());
  content = new ContentApi(this.client);
  sourcePlaylists = new SourcePlaylistCatalog((instance, signal) => this.content.accountPlaylists(instance, null, signal));
  private capabilityEvents = new CapabilityEvents(
    () => {
      capabilityResources.invalidate();
      if (this.auth.value.session) this.reloadSourceNames();
    },
    (signal) => this.client.request("/auth/session", { signal }),
  );
  auth = new Store<AuthState>({
    session: null,
    ready: null,
    busy: true,
    error: null,
  });
  preferences = new Store<PreferencesState>({ ...defaults });
  localDSP = new LocalDSPSettingsStore(LocalDSPEngine.supported());
  audioOutput = new AudioOutputSettingsStore(LocalDSPEngine.supported());
  private dsp = new LocalDSPEngine(this.localDSP.value.config, (message) => this.localDSP.reportError(message),
    (status) => this.audioOutput.reportStatus(status));
  playlists = new Store<Playlist[]>([]);
  queue = new PlaybackQueue();
  recordingCovers = new RecordingCovers();
  player: PlayerController;
  playerState: Store<PlayerController["state"]>;
  currentTrack = new Store<string | null>(null);
  private generation = 0;
  private sourceRequest: AbortController | null = null;
  private playlistRequest: AbortController | null = null;
  private libraries = new Map<string, LibraryState>();
  private scans = new LocalScans(new ScansApi(this.client, this.libraryApi), (instance, succeeded) => {
    if (succeeded) for (const id of ["all", instance]) void this.libraries.get(id)?.refresh();
    capabilityResources.invalidate();
    void this.libraryApi.providers().catch(() => {});
  });
  private configurationScans = new ConfigurationScans(this.client, (instance) => this.scans.get(instance).requestAutomatic());
  localScan(instance: string): LocalScanState { return this.scans.get(instance); }
  scanMusicAfterDirectoryOperation(instance: string, operation: PluginOperation): void { this.configurationScans.watch(instance, operation); }
  matchingChanged(): void {
    this.libraries.forEach((library) => { void library.refresh(); });
    capabilityResources.invalidate();
  }
  recordingCoverChanged(recordingId: string, objectId: string | null, sourceTrackIds: string[] = []): void {
    this.recordingCovers.update(recordingId, objectId, this.coverTracks(), sourceTrackIds);
    this.libraries.forEach((library) => { void library.refresh(); });
  }
  private coverTracks(): SourceTrack[] {
    return this.player.state.track ? [...this.queue.value.items, this.player.state.track] : this.queue.value.items;
  }
  invalidateLibraries(): void {
    this.libraries.forEach((library, provider) => {
      library.clear();
      if (library.onChange) void library.select(provider);
    });
  }
  library(provider: string): LibraryState {
    if (!this.libraries.has(provider))
      this.libraries.set(
        provider,
        new LibraryState((p, cursor, signal) =>
          this.libraryApi.page(p, cursor, signal, true),
          (items) => this.recordingCovers.reconcile(items, this.coverTracks()),
        ),
      );
    return this.libraries.get(provider)!;
  }
  constructor(root: HTMLElement) {
    let config = this.localDSP.value.config;
    this.localDSP.subscribe(() => {
      if (config === this.localDSP.value.config) return;
      config = this.localDSP.value.config;
      this.dsp.setConfig(config);
    });
    let output = this.audioOutput.value.config;
    this.audioOutput.subscribe(() => {
      if (output === this.audioOutput.value.config) return;
      output = this.audioOutput.value.config;
      this.dsp.setOutput(output);
    });
    this.content.onlineInstances.subscribe(() => this.sourcePlaylists.update(this.content.onlineInstances.value));
    this.player = new PlayerController(
      new PlaybackApi(this.client),
      audioFactory(root, this.dsp),
      capabilities(document.createElement("audio")),
      () => this.dsp.unlock(),
    );
    this.playerState = new Store({ ...this.player.state });
    this.player.onSelectionCancelled = () => this.queue.rollbackSelection();
    this.player.onChange = () => {
      // 仅提交已开始解析的选择，保留切歌中 stop 发出的瞬时空曲目之前的队列。
      if (this.player.state.phase === "resolving" && this.playerState.value.phase !== "resolving") {
        this.queue.commitSelection();
      }
      const ended =
        this.player.state.phase === "ended" &&
        this.playerState.value.phase !== "ended";
      this.playerState.set({ ...this.player.state });
      const current = this.player.state.track?.sourceTrackId ?? null;
      if (current !== this.currentTrack.value) this.currentTrack.set(current);
      if (ended)
        queueMicrotask(() => {
          if (this.player.state.phase === "ended") this.advanceQueue(1, true);
        });
    };
    this.client.onUnauthorized = () => this.clear();
  }
  private key(): string | null {
    const { ready, session } = this.auth.value;
    return ready && session
      ? `musicfs:${encodeURIComponent(ready.instanceId)}:${encodeURIComponent(session.user.id)}:preferences`
      : null;
  }
  inspectAudioOutput(): void { this.dsp.inspectOutput(); }
  private accept(session: AuthSession): void {
    this.recordingCovers.clear();
    this.player.stop();
    this.queue.forgetSelection();
    this.dsp.dispose();
    this.sourcePlaylists.clear();
    this.content.clearOnlineInstances();
    this.libraryApi.clearProviderInstances();
    this.auth.set({ ...this.auth.value, session, busy: false, error: null });
    this.scans.setSession(this.auth.value.ready!.instanceId, session.user.id);
    this.configurationScans.setSession(this.auth.value.ready!.instanceId, session.user.id);
    this.matchingDecisions.setSession(this.auth.value.ready!.instanceId, session.user.id);
    this.favorites.setSession(this.auth.value.ready!.instanceId, session.user.id);
    void this.favorites.load();
    this.profile.setUser(session.user.id);
    this.localDSP.setSession(this.auth.value.ready!.instanceId, session.user.id);
    // ready.instanceId 是每次启动的进程身份；输出偏好按稳定服务地址保存。
    this.audioOutput.setSession(new URL(this.client.url(""), window.location.href).href, session.user.id);
    this.reloadSourceNames();
    this.capabilityEvents.start(session.csrfToken);
    let saved: Partial<PreferencesState> = {};
    try {
      saved = JSON.parse(localStorage.getItem(this.key()!) ?? "{}");
    } catch {
      /* Storage may be unavailable. */
    }
    this.preferences.set({
      theme:
        saved?.theme === "dark" ||
        saved?.theme === "light" ||
        saved?.theme === "system"
          ? saved.theme
          : defaults.theme,
      ...volumePreferences(saved),
      lyricsPinned: saved?.lyricsPinned === true,
      queuePinned: saved?.queuePinned === true,
      mine: saved?.mine !== false,
      playlists: saved?.playlists !== false,
      works: saved?.works === true,
      processing: saved?.processing === true,
      fadeEnabled: saved?.fadeEnabled === true,
      fadeDurationMs: typeof saved?.fadeDurationMs === "number" && Number.isFinite(saved.fadeDurationMs)
        ? Math.max(100, Math.min(2000, saved.fadeDurationMs)) : defaults.fadeDurationMs,
      autoVolume: saved?.autoVolume === true,
    });
    this.player.setVolume(this.preferences.value.volume);
    this.player.setTransitions(this.preferences.value.fadeEnabled, this.preferences.value.fadeDurationMs);
    this.dsp.setAutoVolume(this.preferences.value.autoVolume);
    void this.reloadPlaylists().catch(() => {});
  }
  async connect(): Promise<void> {
    const generation = ++this.generation;
    this.auth.set({ ...this.auth.value, busy: true, error: null });
    try {
      const ready = await this.authApi.ready();
      if (generation !== this.generation) return;
      if (
        ready.product !== "MusicFS" ||
        ready.apiVersion !== "1" ||
        !ready.ready
      )
        throw new Error("Incompatible server");
      this.auth.set({ ...this.auth.value, ready });
      const session = await this.authApi.restore();
      if (generation !== this.generation) return;
      this.accept(session);
    } catch (e) {
      this.auth.set({
        ...this.auth.value,
        busy: false,
        error:
          e instanceof ApiError && e.status === 401
            ? null
            : e instanceof ApiError
              ? errorMessage(e)
              : "需要已就绪的 MusicFS API v1 服务。",
      });
    }
  }
  async login(token: string): Promise<void> {
    if (!this.auth.value.ready) return;
    const generation = ++this.generation;
    this.auth.set({ ...this.auth.value, busy: true, error: null });
    try {
      const session = await this.authApi.login(token);
      if (generation !== this.generation) return;
      this.accept(session);
    } catch (e) {
      this.auth.set({
        ...this.auth.value,
        busy: false,
        error: errorMessage(e),
      });
    }
  }
  async logout(): Promise<void> {
    const generation = ++this.generation;
    this.capabilityEvents.stop();
    this.player.stop();
    this.auth.set({ ...this.auth.value, busy: true, error: null });
    try {
      await this.authApi.logout();
      if (generation !== this.generation) return;
      this.clear();
    } catch (e) {
      if (generation !== this.generation) return;
      const session = this.auth.value.session;
      if (session) this.capabilityEvents.start(session.csrfToken);
      this.auth.set({
        ...this.auth.value,
        busy: false,
        error: errorMessage(e),
      });
    }
  }
  clear(): void {
    this.favorites.clear();
    this.recordingCovers.clear();
    this.matchingDecisions.clear();
    this.configurationScans.clear();
    this.scans.clear();
    this.profile.setUser(null);
    this.capabilityEvents.stop();
    this.sourceRequest?.abort();
    this.sourcePlaylists.clear();
    this.content.clearOnlineInstances();
    this.libraryApi.clearProviderInstances();
    this.libraries.forEach((library) => library.clear());
    this.libraries.clear();
    ++this.generation;
    this.playlistRequest?.abort();
    this.player.stop();
    this.dsp.dispose();
    this.queue.clear();
    this.playlists.set([]);
    this.client.csrfToken = null;
    this.preferences.set({ ...defaults });
    this.player.setTransitions(false, defaults.fadeDurationMs);
    this.dsp.setAutoVolume(false);
    this.localDSP.clear();
    this.audioOutput.clear();
    this.auth.set({
      ...this.auth.value,
      session: null,
      busy: false,
      error: null,
    });
  }
  preference(patch: Partial<PreferencesState>): void {
    const volume = volumePreferences({ ...this.preferences.value, ...patch });
    if (patch.volume !== undefined && volume.volume > 0) volume.lastVolume = volume.volume;
    this.preferences.set({ ...this.preferences.value, ...patch, ...volume });
    this.player.setVolume(this.preferences.value.volume);
    this.player.setTransitions(this.preferences.value.fadeEnabled, this.preferences.value.fadeDurationMs);
    this.dsp.setAutoVolume(this.preferences.value.autoVolume);
    const key = this.key();
    if (key)
      try {
        localStorage.setItem(key, JSON.stringify(this.preferences.value));
      } catch {
        /* Preferences remain in memory. */
      }
  }
  toggleMute(): void {
    const { volume, lastVolume } = this.preferences.value;
    this.preference({ volume: volume > 0 ? 0 : lastVolume });
  }
  private async reloadSourceNames(): Promise<void> {
    this.sourceRequest?.abort();
    const request = new AbortController();
    this.sourceRequest = request;
    await Promise.allSettled([this.content.online(request.signal), this.libraryApi.providers(request.signal)]);
  }
  async platformAccountChanged(instance: string, signedIn: boolean): Promise<void> {
    this.sourcePlaylists.invalidate(instance);
    const generation = this.generation;
    await this.reloadSourceNames();
    if (generation === this.generation && signedIn) this.sourcePlaylists.refresh(instance);
  }
  async reloadPlaylists(): Promise<void> {
    this.playlistRequest?.abort();
    const request = new AbortController();
    this.playlistRequest = request;
    const generation = this.generation;
    const items: Playlist[] = [];
    let after: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await this.content.playlists(after, request.signal);
      items.push(...page.items);
      after = page.nextAfter;
      if (after && seen.has(after))
        throw new ApiError("PAGINATION_STALLED", "Playlist pagination stalled");
      if (after) seen.add(after);
    } while (after);
    if (generation === this.generation && !request.signal.aborted)
      this.playlists.set(items);
  }
  play(track: SourceTrack, items?: SourceTrack[]): void {
    if (track.availability !== "available") return;
    if (items) this.queue.replace(track, items);
    else {
      this.queue.enqueue([track]);
      this.queue.select(this.queue.value.items.length - 1);
    }
    void this.player.select(track, this.playbackPreferences());
  }
  playQueueIndex(index: number): void {
    const track = this.queue.select(index);
    if (track) void this.player.select(track, this.playbackPreferences());
  }
  playbackPreferences(): Preferences {
    return {
      forceProcessing: this.preferences.value.processing,
      gainDb: 0,
      dspExecution: "client",
    };
  }
  enqueue(items: SourceTrack[]): void {
    this.queue.enqueue(items);
  }
  playNext(items: SourceTrack[]): void { this.queue.playNext(items); }
  setPlaybackMode(mode: PlaybackMode): void { this.queue.setMode(mode); }
  shuffleQueue(): void { this.queue.shuffle(); }
  canNext(direction: number): boolean { return this.queue.canAdvance(direction); }
  next(direction: number): void {
    this.advanceQueue(direction);
  }
  private advanceQueue(direction: number, ended = false): void {
    const track = this.queue.advance(direction, ended);
    if (track) void this.player.select(track, this.playbackPreferences());
  }
}
export const ServicesContext = createContext<Services | null>(null);
export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("Missing services");
  return services;
}
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
