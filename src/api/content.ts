import { ApiClient, ApiError, type RequestOptions } from "./client";
import { Store } from "../app/store";
import { withRateLimitRetry } from "./rate-limit";
import type { PluginIdentity } from "./types";
export type { PluginIdentity } from "./types";

export interface OnlineInstance {
  instanceId: string;
  name: string;
  platform: string;
  authentication?: string;
  sourceType?: "local" | "network";
  plugin?: PluginIdentity;
  accountId?: string;
  accountRevision?: string;
  availability: string;
  capabilities: { name: string; supported: boolean; reason: string }[];
}
export interface OnlineTrack {
  externalId: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number | null;
  sourceUrl: string;
}
export interface OnlinePlaylist {
  externalId: string;
  title: string;
  sourceUrl: string;
  coverUrl: string | null;
  trackCount: number | null;
  writable?: boolean;
}
export interface AccountPlaylistPage {
  items: OnlinePlaylist[];
  nextCursor: string | null;
  consistency: "unversioned";
  observedAt: string;
}
export interface Observation {
  playlist: OnlinePlaylist;
  entries: { position: number; externalTrackId: string }[];
  complete: boolean;
  observedAt: string;
}
export interface SearchPage {
  tracks: OnlineTrack[];
  nextCursor: string | null;
  truncated: boolean;
}
export interface RecommendationSource {
  instanceId: string;
  name: string;
  items: { playlist: OnlinePlaylist; reason: string; position: number }[];
  stale: boolean;
  expiresAt: string | null;
  lastSuccessAt: string | null;
  error: { code: string; message: string } | null;
}
export interface SourceRef {
  trackId?: string | null;
  forcedSourceTrackId?: string | null;
  sourceTrackId: string | null;
  remoteSourceId: string | null;
}
export interface Binding {
  bindingId?: string;
  kind: "local" | "remote" | "playlist";
  targetId?: string | null;
  entries?: { entryId?: string; source: SourceRef }[];
}
export interface Playlist {
  playlistId: string;
  name: string;
  ruleRevision: number;
  hideRevision: number;
  snapshotRevision: number;
  stale: boolean;
  bindings: Binding[];
}
export interface PlaylistEntry {
  entryId: string;
  source: SourceRef;
  provenance: {
    state: string;
    hidden: boolean;
    entryId: string;
    source: SourceRef;
  }[];
}
export interface SnapshotPage {
  playlistId: string;
  revision: number;
  items: PlaylistEntry[];
  nextOffset: number | null;
  needsConfirmation: string[];
}
export interface RemotePlaylist {
  playlistId: string;
  instanceId: string;
  externalId: string;
  title: string;
  bindingRevision: number;
  revision: number;
  stale: boolean;
  lastSuccessAt: string | null;
  error: { code: string } | null;
}
export interface SyncJob {
  jobId: string;
  state: string;
  resultRevision: number | null;
  error: { code: string } | null;
}
export interface Album {
  sourceAlbumId: string;
  providerInstanceId: string;
  name: string;
  sourceTrackIds: string[];
  revision: number;
  coverObjectId?: string | null;
}
export interface AfterPage<T> {
  items: T[];
  nextAfter: string | null;
}
const id = encodeURIComponent;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object";
const string = (v: unknown): v is string => typeof v === "string";
const list = (v: unknown): v is unknown[] => Array.isArray(v);
function checked<T>(value: T, valid: (v: T) => boolean): T {
  if (!object(value) || !valid(value))
    throw new ApiError("INVALID_RESPONSE", "Invalid content response");
  return value;
}
const isPlaylist = (p: Playlist) =>
  object(p) &&
  string(p.playlistId) &&
  string(p.name) &&
  Number.isInteger(p.ruleRevision) &&
  list(p.bindings);

export class ContentApi {
  readonly onlineInstances = new Store<OnlineInstance[]>([]);
  private onlineEpoch = 0;
  private onlineRequest = 0;
  private onlineApplied = 0;
  constructor(private client: ApiClient) {}
  clearOnlineInstances(): void {
    ++this.onlineEpoch;
    this.onlineInstances.set([]);
  }
  private async write<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    const options = { method, body, idempotencyKey: crypto.randomUUID() };
    try { return await this.client.request<T>(path, options); }
    catch (error) {
      if (!(error instanceof ApiError) || !['TIMEOUT', 'NETWORK_ERROR'].includes(error.code)) throw error;
      return this.client.request<T>(path, options);
    }
  }
  async online(signal?: AbortSignal): Promise<OnlineInstance[]> {
    const epoch = this.onlineEpoch;
    const request = ++this.onlineRequest;
    const v = await this.client.request<{ items: OnlineInstance[] }>(
      "/online-instances",
      { signal },
    );
    const items = checked(
      v,
      (r) =>
        list(r.items) &&
        r.items.every(
          (p) => object(p) && string(p.instanceId) && list(p.capabilities),
        ),
    ).items;
    if (epoch === this.onlineEpoch && request > this.onlineApplied && !signal?.aborted) {
      this.onlineApplied = request;
      this.onlineInstances.set(items);
    }
    return items;
  }
  async search(
    instance: string,
    q: string,
    cursor: string | null,
    signal?: AbortSignal,
  ): Promise<SearchPage> {
    const query = new URLSearchParams({ q, limit: "30" });
    if (cursor) query.set("cursor", cursor);
    return checked(
      await withRateLimitRetry(() => this.client.request<SearchPage>(
        `/online-instances/${id(instance)}/search?${query}`,
        { signal },
      ), signal),
      (r) =>
        list(r.tracks) &&
        r.tracks.every(
          (t) =>
            object(t) &&
            string(t.externalId) &&
            string(t.title) &&
            list(t.artists),
        ) &&
        (r.nextCursor === null || string(r.nextCursor)),
    );
  }
  async recommendations(
    refresh: boolean,
    signal?: AbortSignal,
  ): Promise<RecommendationSource[]> {
    const v = await this.client.request<{ sources: RecommendationSource[] }>(
      `/recommendations?refresh=${refresh}`,
      { signal },
    );
    return checked(
      v,
      (r) =>
        list(r.sources) &&
        r.sources.every(
          (s) =>
            object(s) &&
            string(s.instanceId) &&
            list(s.items) &&
            s.items.every(
              (i) =>
                object(i.playlist) &&
                string(i.playlist.externalId) &&
                string(i.playlist.title),
            ),
        ),
    ).sources;
  }
  async accountPlaylists(instance: string, cursor: string | null, signal?: AbortSignal): Promise<AccountPlaylistPage> {
    const query = new URLSearchParams({ limit: "30" });
    if (cursor) query.set("cursor", cursor);
    return checked(
      await this.client.request<AccountPlaylistPage>(`/online-instances/${id(instance)}/playlists?${query}`, { signal }),
      (r) => list(r.items) && r.items.every((p) => object(p) && string(p.externalId) && string(p.title)) &&
        (r.nextCursor === null || string(r.nextCursor)) && r.consistency === "unversioned" && string(r.observedAt),
    );
  }
  async observation(
    instance: string,
    external: string,
    signal?: AbortSignal,
  ): Promise<Observation> {
    return checked(
      await withRateLimitRetry(() => this.client.request<Observation>(
        `/online-instances/${id(instance)}/playlists/${id(external)}`,
        { signal },
      ), signal),
      (r) => object(r.playlist) && string(r.playlist.title) && list(r.entries),
    );
  }
  async playlistReference(instance: string, reference: string, signal?: AbortSignal): Promise<OnlinePlaylist> {
    const query = new URLSearchParams({ kind: "playlists", q: reference.trim(), limit: "1" });
    const result = await this.client.request<{ playlists: OnlinePlaylist[] }>(`/online-instances/${id(instance)}/search?${query}`, { signal });
    if (!Array.isArray(result.playlists) || result.playlists.length !== 1 || !string(result.playlists[0].externalId)) {
      throw new ApiError("INVALID_RESPONSE", "Invalid playlist reference");
    }
    return result.playlists[0];
  }
  async playlists(
    after: string | null = null,
    signal?: AbortSignal,
  ): Promise<AfterPage<Playlist>> {
    return checked(
      await this.client.request<AfterPage<Playlist>>(
        `/playlists?limit=100${after ? `&after=${id(after)}` : ""}`,
        { signal },
      ),
      (r) =>
        list(r.items) &&
        r.items.every(isPlaylist) &&
        (r.nextAfter === null || string(r.nextAfter)),
    );
  }
  async playlist(key: string, signal?: AbortSignal): Promise<Playlist> {
    return checked(
      await this.client.request<Playlist>(`/playlists/${id(key)}`, { signal }),
      isPlaylist,
    );
  }
  async create(name: string, bindings: Binding[] = []): Promise<Playlist> {
    return checked(
      await this.write<Playlist>("/playlists", { name, bindings }),
      isPlaylist,
    );
  }
  async edit(
    p: Playlist,
    name: string,
    bindings = p.bindings,
  ): Promise<Playlist> {
    return checked(
      await this.write<Playlist>(
        `/playlists/${id(p.playlistId)}`,
        { expectedRevision: p.ruleRevision, name, bindings },
        "PUT",
      ),
      isPlaylist,
    );
  }
  rebuild(p: Playlist): Promise<{ revision: number }> {
    return this.write(`/playlists/${id(p.playlistId)}/rebuild`, {
      expectedRuleRevision: p.ruleRevision,
    });
  }
  async snapshot(
    key: string,
    revision: number,
    offset: number,
    signal?: AbortSignal,
  ): Promise<SnapshotPage> {
    return checked(
      await this.client.request<SnapshotPage>(
        `/playlists/${id(key)}/snapshots/${revision}?offset=${offset}&limit=100`,
        { signal },
      ),
      (r) =>
        list(r.items) &&
        r.revision === revision &&
        (r.nextOffset === null || Number.isInteger(r.nextOffset)),
    );
  }
  async remote(
    after: string | null = null,
    signal?: AbortSignal,
  ): Promise<AfterPage<RemotePlaylist>> {
    return checked(
      await this.client.request<AfterPage<RemotePlaylist>>(
        `/remote-playlists?limit=100${after ? `&after=${id(after)}` : ""}`,
        { signal },
      ),
      (r) =>
        list(r.items) &&
        r.items.every((p) => string(p.playlistId)) &&
        (r.nextAfter === null || string(r.nextAfter)),
    );
  }
  async importRemote(
    instanceId: string,
    externalId: string,
  ): Promise<{ playlist: RemotePlaylist; merged: boolean }> {
    const instances = await this.online();
    if (instances.find((instance) => instance.instanceId === instanceId)?.authentication === "anonymous") {
      return this.write("/remote-playlists", { instanceId, externalId, accountId: "" });
    }
    const account = await this.client.request<{ state: string; accountId?: string }>(
      '/online-instances/' + id(instanceId) + '/account',
    );
    if (account.state !== "signedIn" || !account.accountId) {
      throw new ApiError("PLATFORM_AUTH_REQUIRED", "Sign in to the music platform", 403);
    }
    return this.write("/remote-playlists", { instanceId, externalId, accountId: account.accountId });
  }
  async sync(p: RemotePlaylist): Promise<SyncJob> {
    const receipt = await this.write<{ jobId: string }>(
      `/remote-playlists/${id(p.playlistId)}/sync-jobs`,
      { expectedBindingRevision: p.bindingRevision },
    );
    return this.syncJob(receipt.jobId);
  }
  syncJob(job: string, signal?: AbortSignal): Promise<SyncJob> {
    return this.client.request(`/remote-playlist-sync-jobs/${id(job)}`, {
      signal,
    });
  }
  async albums(
    after: string | null,
    signal?: AbortSignal,
  ): Promise<AfterPage<Album>> {
    return checked(
      await this.client.request<AfterPage<Album>>(
        `/source-albums?limit=100${after ? `&after=${id(after)}` : ""}`,
        { signal },
      ),
      (r) =>
        list(r.items) &&
        r.items.every(
          (a) =>
            string(a.sourceAlbumId) && string(a.name) && list(a.sourceTrackIds),
        ) &&
        (r.nextAfter === null || string(r.nextAfter)),
    );
  }
  album(key: string, options?: RequestOptions): Promise<Album> {
    return this.client.request(`/source-albums/${id(key)}`, options);
  }
}
