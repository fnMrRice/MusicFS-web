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
import { PlaybackSessionRenewal } from "./playback-session-renewal";
import { PreferencesStore, type PreferencesState } from "./preferences";
import { PlaybackQueue, type PlaybackMode } from "../player/playback-queue";
import { QueuePersistence } from "../player/queue-persistence";
import { OnlinePlaylistPlayback } from "../player/online-playlist-playback";
import { audioFactory } from "../player/audio-adapter";
import { capabilities } from "../player/capabilities";
import { Store } from "./store";
import { LibraryState } from "../library/state";
import { displaySource, MusicCatalogApi, playlistTrack } from "../api/music-catalog";
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
import { RecordingCovers } from "./recording-covers";
import { FavoritesApi } from "../api/favorites";
import { FavoritesState } from "../library/favorites";
import { TasksApi } from "../api/tasks";
import { TaskQueueState } from "../tasks/task-queue-state";
import { RefreshSubmission } from "../tasks/refresh-submission";

interface AuthState {
  session: AuthSession | null;
  ready: Ready | null;
  busy: boolean;
  error: string | null;
}
export class Services {
  client = new ApiClient();
  authApi = new AuthApi(this.client);
  private playbackRenewal = new PlaybackSessionRenewal((id, signal) =>
    this.client.request(`/playback/sessions/${encodeURIComponent(id)}/keepalive`, { method: "POST", signal }));
  profile = new PersonalProfileState(new ProfileApi(this.client));
  libraryApi = new LibraryApi(this.client);
  musicCatalog = new MusicCatalogApi(this.client);
  favorites = new FavoritesState(new FavoritesApi(this.client));
  matchingDecisions = new MatchingDecisions(new MatchingApi(this.client), () => this.matchingChanged());
  content = new ContentApi(this.client);
  sourcePlaylists = new SourcePlaylistCatalog((instance, signal, cursor, refresh) => this.content.accountPlaylists(instance, cursor, signal, refresh));
  private capabilityEvents = new CapabilityEvents(
    () => {
      capabilityResources.invalidate();
      if (this.auth.value.session) this.reloadSourceNames();
    },
    (signal) => this.client.request("/auth/session", { signal }),
    () => this.clear(),
    () => { this.player.stop(); void this.connect(); },
    { ready: () => this.tasks.connection(true), disconnected: () => this.tasks.connection(false), receive: data => this.tasks.receive(data) },
  );
  controlStatus = this.capabilityEvents.channel.status;
  activity = this.capabilityEvents.activity;
  downloads = this.capabilityEvents.downloads;
  auth = new Store<AuthState>({
    session: null,
    ready: null,
    busy: true,
    error: null,
  });
  preferences = new PreferencesStore();
  localDSP = new LocalDSPSettingsStore(LocalDSPEngine.supported());
  audioOutput = new AudioOutputSettingsStore(LocalDSPEngine.supported());
  private dsp = new LocalDSPEngine(this.localDSP.value.config, (message) => this.localDSP.reportError(message),
    (status) => this.audioOutput.reportStatus(status));
  playlists = new Store<Playlist[]>([]);
  queue = new PlaybackQueue();
  onlinePlaylistPlayback = new OnlinePlaylistPlayback(this.client, this.queue, (items, start) => {
    if (start) this.play(items[0], items);
    else {
      this.enqueue(items);
      if (this.player.state.phase === "ended") this.advanceQueue(1, true);
    }
  });
  private queuePersistence = new QueuePersistence(this.queue);
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
  albumRevision = new Store(0);
  tasks = new TaskQueueState(new TasksApi(this.client), (task) => {
    if (task.kind === "bulkMerge") {
      if (task.result.mergedGroups > 0) this.matchingChanged();
      return;
    }
    if (task.kind === "albumAutoScrape") {
      if (task.result.updated > 0) {
        this.albumRevision.set(this.albumRevision.value + 1);
        this.invalidateLibraries();
      }
      return;
    }
    for (const id of ["all", task.providerInstanceId]) void this.libraries.get(id)?.refresh();
    capabilityResources.invalidate();
    void this.libraryApi.providers().catch(() => {});
    void this.scans.get(task.providerInstanceId).refreshStatus();
  });
  refreshSubmissions = new RefreshSubmission(new ScansApi(this.client, this.libraryApi), (instance) => {
    void this.scans.get(instance).refreshStatus();
  });
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
          this.musicCatalog.tracks({ providerInstanceId: p, sourceOnly: true }, cursor, signal),
          (items) => this.recordingCovers.reconcile(items.map(displaySource).filter((item) => item !== null), this.coverTracks()),
        ),
      );
    return this.libraries.get(provider)!;
  }
  constructor(root: HTMLElement) {
    this.client.controlTransport = this.capabilityEvents.channel;
    this.activity.subscribe("scans", () => this.scans.invalidate());
    this.activity.subscribe("configuration", () => {
      this.configurationScans.invalidate();
      this.scans.capabilitiesChanged();
    });
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
    this.content.onlineInstances.subscribe(() => {
      const sources = this.content.onlineInstances.value;
      this.sourcePlaylists.update(sources);
      this.onlinePlaylistPlayback.updateSources(sources);
    });
    this.player = new PlayerController(
      new PlaybackApi(this.client),
      audioFactory(root, this.dsp),
      capabilities(document.createElement("audio")),
      () => this.dsp.unlock(),
      async ({ trackId, forcedSourceTrackId }, signal) => {
        const track = await this.musicCatalog.track(trackId, signal);
        const source = displaySource(playlistTrack(track, forcedSourceTrackId));
        if (!source || source.availability !== "available") throw new ApiError("SOURCE_UNAVAILABLE", "Playlist source unavailable", 409);
        return source;
      },
    );
    this.player.onPlaybackStarted = async (playback, signal) => {
      const body = {sourceTrackId: playback.sourceTrackId, playbackSessionId: playback.sessionId, attemptId: playback.attemptId};
      try {
        await this.client.request("/me/recently-played", {method: "POST", body, signal});
      } catch (error) {
        if (signal.aborted || error instanceof ApiError && error.status && error.status < 500) throw error;
        await this.client.request("/me/recently-played", {method: "POST", body, signal});
      }
      if (!signal.aborted) window.dispatchEvent(new Event("musicfs:history-changed"));
    };
    this.playerState = new Store({ ...this.player.state });
    this.player.onSelectionCancelled = () => this.queue.rollbackSelection();
    this.player.onChange = () => {
      this.playbackRenewal.setPlayback(this.player.state.playback, this.player.state.phase === "playing" && this.player.state.wantsPlay);
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
    this.client.onAuthenticated = (startedAt) => this.playbackRenewal.activity(startedAt);
  }
  inspectAudioOutput(): void { this.dsp.inspectOutput(); }
  private accept(session: AuthSession): void {
    this.client.csrfToken = session.csrfToken;
    this.onlinePlaylistPlayback.cancel();
    const serverAddress = new URL(this.client.url(""), window.location.href).href;
    const instanceId = this.auth.value.ready!.instanceId;
    this.recordingCovers.clear();
    this.queuePersistence.setServer(serverAddress, session.user.id);
    const { items, index } = this.queue.value;
    this.player.restorePaused(items[index] ?? null);
    this.playbackRenewal.setSession(session);
    this.dsp.dispose();
    this.sourcePlaylists.clear();
    this.content.clearOnlineInstances();
    this.libraryApi.clearProviderInstances();
    this.auth.set({ ...this.auth.value, session, busy: false, error: null });
    this.scans.setSession(instanceId, session.user.id);
    this.refreshSubmissions.setSession(serverAddress, session.user.id);
    this.tasks.start(session.user.role === "admin");
    this.configurationScans.setSession(instanceId, session.user.id);
    this.matchingDecisions.setSession(instanceId, session.user.id);
    this.favorites.setSession(instanceId, session.user.id);
    void this.favorites.load();
    this.profile.setUser(session.user.id);
    this.localDSP.setSession(instanceId, session.user.id);
    // ready.instanceId 是每次启动的进程身份；输出偏好按稳定服务地址保存。
    this.audioOutput.setSession(serverAddress, session.user.id);
    this.reloadSourceNames();
    this.capabilityEvents.start(session.csrfToken);
    if (["online", "ready", "not-ready"].includes(this.controlStatus.getSnapshot().phase)) this.tasks.connection(true);
    this.preferences.load(instanceId, session.user.id);
    this.player.setVolume(this.preferences.value.volume);
    this.player.setTransitions(this.preferences.value.fades);
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
      if (generation !== this.generation) return;
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
      if (generation !== this.generation) return;
      this.auth.set({
        ...this.auth.value,
        busy: false,
        error: errorMessage(e),
      });
    }
  }
  async logout(): Promise<void> {
    this.onlinePlaylistPlayback.cancel();
    const generation = ++this.generation;
    this.player.stop();
    this.capabilityEvents.stop();
    this.auth.set({ ...this.auth.value, busy: true, error: null });
    try {
      await this.authApi.logout();
      if (generation !== this.generation) return;
      this.queuePersistence.clear();
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
    this.playbackRenewal.setSession(null);
    this.onlinePlaylistPlayback.cancel();
    this.queuePersistence.detach();
    this.tasks.clear();
    this.refreshSubmissions.clear();
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
    this.preferences.reset();
    this.player.setTransitions(this.preferences.value.fades);
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
    this.preferences.update(patch);
    this.player.setVolume(this.preferences.value.volume);
    if (patch.fades) this.player.setTransitions(patch.fades);
    this.dsp.setAutoVolume(this.preferences.value.autoVolume);
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
    else this.queue.selectOrAppend(track);
    void this.player.select(track, this.playbackPreferences());
  }
  playSelection(tracks: SourceTrack[]): void {
    const available = tracks.filter((track) => track.availability === "available");
    if (available.length === 1) this.play(available[0]);
    else if (available.length > 1) {
      const start = this.queue.value.items.length;
      this.queue.enqueue(available);
      this.playQueueIndex(start);
    }
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
