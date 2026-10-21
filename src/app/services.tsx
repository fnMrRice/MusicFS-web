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
import { MatchingApi } from "../api/matching";
import { MatchingDecisions } from "../library/matching-decisions";

interface AuthState {
  session: AuthSession | null;
  ready: Ready | null;
  busy: boolean;
  error: string | null;
}
interface PreferencesState {
  theme: "dark" | "light" | "system";
  volume: number;
  mine: boolean;
  playlists: boolean;
  processing: boolean;
}
const defaults: PreferencesState = {
  theme: "system",
  volume: 0.8,
  mine: true,
  playlists: true,
  processing: false,
};
export class Services {
  client = new ApiClient();
  authApi = new AuthApi(this.client);
  profile = new PersonalProfileState(new ProfileApi(this.client));
  libraryApi = new LibraryApi(this.client);
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
  playlists = new Store<Playlist[]>([]);
  queue = new Store<{ items: SourceTrack[]; index: number; repeat: boolean }>({
    items: [],
    index: -1,
    repeat: false,
  });
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
  library(provider: string): LibraryState {
    if (!this.libraries.has(provider))
      this.libraries.set(
        provider,
        new LibraryState((p, cursor, signal) =>
          this.libraryApi.page(p, cursor, signal, true),
        ),
      );
    return this.libraries.get(provider)!;
  }
  constructor(root: HTMLElement) {
    this.content.onlineInstances.subscribe(() => this.sourcePlaylists.update(this.content.onlineInstances.value));
    this.player = new PlayerController(
      new PlaybackApi(this.client),
      audioFactory(root),
      capabilities(document.createElement("audio")),
    );
    this.playerState = new Store({ ...this.player.state });
    this.player.onChange = () => {
      const ended =
        this.player.state.phase === "ended" &&
        this.playerState.value.phase !== "ended";
      this.playerState.set({ ...this.player.state });
      const current = this.player.state.track?.sourceTrackId ?? null;
      if (current !== this.currentTrack.value) this.currentTrack.set(current);
      if (ended)
        queueMicrotask(() => {
          if (this.player.state.phase === "ended") this.next(1);
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
  private accept(session: AuthSession): void {
    this.sourcePlaylists.clear();
    this.content.clearOnlineInstances();
    this.libraryApi.clearProviderInstances();
    this.auth.set({ ...this.auth.value, session, busy: false, error: null });
    this.scans.setSession(this.auth.value.ready!.instanceId, session.user.id);
    this.configurationScans.setSession(this.auth.value.ready!.instanceId, session.user.id);
    this.matchingDecisions.setSession(this.auth.value.ready!.instanceId, session.user.id);
    this.profile.setUser(session.user.id);
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
      volume:
        typeof saved?.volume === "number" &&
        saved.volume >= 0 &&
        saved.volume <= 1
          ? saved.volume
          : 0.8,
      mine: saved?.mine !== false,
      playlists: saved?.playlists !== false,
      processing: saved?.processing === true,
    });
    this.player.setVolume(this.preferences.value.volume);
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
    this.queue.set({ items: [], index: -1, repeat: false });
    this.playlists.set([]);
    this.client.csrfToken = null;
    this.preferences.set({ ...defaults });
    this.auth.set({
      ...this.auth.value,
      session: null,
      busy: false,
      error: null,
    });
  }
  preference(patch: Partial<PreferencesState>): void {
    this.preferences.set({ ...this.preferences.value, ...patch });
    this.player.setVolume(this.preferences.value.volume);
    const key = this.key();
    if (key)
      try {
        localStorage.setItem(key, JSON.stringify(this.preferences.value));
      } catch {
        /* Preferences remain in memory. */
      }
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
    const candidates = items?.filter((t) => t.availability === "available") ?? [
      track,
    ];
    this.queue.set({
      ...this.queue.value,
      items: candidates,
      index: candidates.findIndex(
        (t) => t.sourceTrackId === track.sourceTrackId,
      ),
    });
    void this.player.select(track, this.playbackPreferences());
  }
  playbackPreferences(): Preferences {
    return {
      forceProcessing: this.preferences.value.processing,
      gainDb: this.preferences.value.processing ? -6 : 0,
    };
  }
  enqueue(items: SourceTrack[]): void {
    this.queue.set({
      ...this.queue.value,
      items: [
        ...this.queue.value.items,
        ...items.filter((t) => t.availability === "available"),
      ],
    });
  }
  next(direction: number): void {
    const q = this.queue.value;
    let index = q.index + direction;
    if (q.repeat && q.items.length)
      index = (index + q.items.length) % q.items.length;
    if (index < 0 || index >= q.items.length) return;
    this.queue.set({ ...q, index });
    void this.player.select(q.items[index], this.playbackPreferences());
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
