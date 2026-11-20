import { ApiError, errorMessage } from "../api/client";
import type { FavoriteEntry, FavoritesApi } from "../api/favorites";
import { playlistTrack, trackKey, type MusicTrack, type TrackItem } from "../api/music-catalog";
import type { TrackSelection } from "../api/track-selection";
import { Store } from "../app/store";

interface FavoritesSnapshot {
  items: MusicTrack[]; loaded: boolean; loading: boolean; error: string | null; pending: string[];
}
const initial = (): FavoritesSnapshot => ({ items: [], loaded: false, loading: false, error: null, pending: [] });

export class FavoritesState extends Store<FavoritesSnapshot> {
  private session: string | null = null;
  private generation = 0;
  private entries = new Map<string, FavoriteEntry>();
  private aliases = new Map<string, string>();
  private requests = new Set<AbortController>();
  private writes = new Map<string, Promise<void>>();
  private loading: Promise<void> | null = null;
  private changes: Map<string, FavoriteEntry | null> | null = null;
  private overrides = new Map<string, boolean>();
  private dirty = false;
  private batchRevision = 0;
  constructor(private api: Pick<FavoritesApi, "page" | "add" | "remove" | "batch">) { super(initial()); }
  setSession(instance: string, user: string): void {
    const session = JSON.stringify([instance, user]);
    if (session === this.session) return;
    this.clear();
    this.session = session;
  }
  clear(): void {
    ++this.generation;
    this.requests.forEach((request) => request.abort());
    this.requests.clear();
    this.writes.clear();
    this.entries.clear();
    this.aliases.clear();
    this.overrides.clear();
    this.dirty = false;
    this.changes = null;
    this.loading = null;
    this.session = null;
    this.set(initial());
  }
  private canonicalId(id: string): string {
    if (this.aliases.has(id)) return this.aliases.get(id)!;
    if (this.entries.has(id)) return id;
    for (const entry of this.entries.values()) {
      if (entry.musicTrack.selectedSource?.versions?.some((source) => source.sourceTrackId === id)) return entry.musicTrack.trackId;
    }
    return id;
  }
  private remember(track: MusicTrack): void {
    const current = new Set((track.selectedSource?.versions ?? []).map((source) => source.sourceTrackId));
    for (const [id, canonical] of this.aliases) {
      if (canonical === track.trackId && !current.has(id)) this.aliases.delete(id);
    }
    for (const source of track.selectedSource?.versions ?? []) {
      this.aliases.set(source.sourceTrackId, track.trackId);
      const override = this.overrides.get(source.sourceTrackId);
      if (override !== undefined && !this.overrides.has(track.trackId)) this.overrides.set(track.trackId, override);
      if (source.sourceTrackId !== track.trackId) this.overrides.delete(source.sourceTrackId);
    }
  }
  has(id: string): boolean { return this.overrides.get(this.canonicalId(id)) ?? this.entries.has(this.canonicalId(id)); }
  invalidate(): void { this.dirty = true; ++this.batchRevision; }
  // 批量接口返回来源 ID；仅用已知曲目资料更新列表，未知资料留待下次读取。
  applyBatch(ids: string[], favorite: boolean, tracks: TrackItem[]): void {
    this.invalidate();
    const known = new Map<string, MusicTrack>();
    for (const item of tracks) {
      if (!("trackId" in item)) continue;
      this.remember(item);
      known.set(item.trackId, item);
      item.selectedSource?.versions?.forEach((source) => known.set(source.sourceTrackId, item));
    }
    for (const sourceId of ids) {
      const track = known.get(sourceId);
      const id = track?.trackId ?? this.canonicalId(sourceId);
      this.overrides.set(id, favorite);
      if (!favorite) this.entries.delete(id);
      else if (track && !this.entries.has(id)) this.entries.set(id, { musicTrack: track, track: track.selectedSource, forcedSourceTrackId: null, recordedAt: new Date().toISOString() });
      if (!favorite || this.entries.has(id)) this.changes?.set(id, this.entries.get(id) ?? null);
    }
    this.set({ ...this.value, items: this.tracks(), error: null });
  }
  load = (refresh = false): Promise<void> => {
    if (!this.session) return Promise.resolve();
    if (this.loading) return this.loading;
    if (this.value.loaded && !refresh && !this.dirty) return Promise.resolve();
    const generation = this.generation;
    const batchRevision = this.batchRevision;
    const request = new AbortController();
    this.requests.add(request);
    const changes = new Map<string, FavoriteEntry | null>();
    this.changes = changes;
    this.set({ ...this.value, loading: true, error: null });
    const loading = this.readAll(request.signal).then((entries) => {
      if (generation !== this.generation) return;
      // 读取期间完成的写入已由服务端确认，不能被较早的列表快照覆盖。
      changes.forEach((entry, id) => { if (entry) entries.set(id, entry); else entries.delete(id); });
      if (batchRevision === this.batchRevision) { this.aliases.clear(); this.overrides.clear(); this.dirty = false; }
      entries.forEach((entry) => this.remember(entry.musicTrack));
      this.entries = entries;
      this.set({ ...this.value, items: this.tracks(), loaded: true, error: null });
    }).catch((error) => {
      if (generation === this.generation) this.set({ ...this.value, error: errorMessage(error) });
    }).finally(() => {
      this.requests.delete(request);
      if (generation !== this.generation) return;
      this.loading = null;
      this.changes = null;
      this.set({ ...this.value, loading: false });
    });
    this.loading = loading;
    return loading;
  };
  getEntry(id: string): FavoriteEntry | undefined { return this.entries.get(this.canonicalId(id)); }
  setFavorite(track: TrackItem, favorite: boolean, forcedSourceTrackId?: string | null): Promise<void> {
    if (!this.session) return Promise.reject(new ApiError("AUTH_REQUIRED", "Sign in to manage favorites", 401));
    const generation = this.generation;
    const id = this.canonicalId(trackKey(track));
    // 同一曲目的连续操作串行提交，确保服务端最终状态与最后一次选择一致。
    const previous = Promise.allSettled([this.writes.get(id), this.writes.get("@batch")]);
    const operation = previous.catch(() => {}).then(async () => {
      if (generation !== this.generation) return;
      const request = new AbortController();
      this.requests.add(request);
      try {
        const entry = favorite ? await this.api.add(id, request.signal, forcedSourceTrackId) : (await this.api.remove(id, request.signal), null);
        if (generation !== this.generation) return;
        if (entry) this.remember(entry.musicTrack);
        const canonicalId = entry?.musicTrack.trackId ?? this.canonicalId(id);
        if (entry) this.entries.set(canonicalId, entry); else this.entries.delete(canonicalId);
        this.overrides.delete(id);
        this.overrides.delete(canonicalId);
        if ("sourceTrackId" in track) this.overrides.delete(track.sourceTrackId);
        this.changes?.set(canonicalId, entry);
        this.set({ ...this.value, items: this.tracks(), error: null });
      } catch (error) {
        if (generation !== this.generation) return;
        this.set({ ...this.value, error: errorMessage(error) });
        throw error;
      } finally { this.requests.delete(request); }
    }).finally(() => {
      if (generation !== this.generation || this.writes.get(id) !== operation) return;
      this.writes.delete(id);
      this.set({ ...this.value, pending: [...this.writes.keys()] });
    });
    this.writes.set(id, operation);
    this.set({ ...this.value, pending: [...this.writes.keys()], error: null });
    return operation;
  }
  setBatch(selection: TrackSelection, favorite: boolean, tracks: TrackItem[]): Promise<void> {
    if (!this.session) return Promise.reject(new ApiError("AUTH_REQUIRED", "Sign in to manage favorites", 401));
    const generation = this.generation;
    // 已提交的批量写入属于会话；清空选择或离开页面只隐藏反馈，不取消其状态收敛。
    const previous = Promise.allSettled([...this.writes.values()]);
    const operation = previous.then(async () => {
      if (generation !== this.generation) return;
      const request = new AbortController();
      this.requests.add(request);
      this.invalidate();
      try {
        const result = await this.api.batch(selection, favorite, request.signal);
        if (generation === this.generation) this.applyBatch(result.sourceTrackIds, favorite, tracks);
      } catch (error) {
        if (generation !== this.generation) return;
        this.set({ ...this.value, error: errorMessage(error) });
        throw error;
      } finally { this.requests.delete(request); }
    }).finally(() => {
      if (generation !== this.generation || this.writes.get("@batch") !== operation) return;
      this.writes.delete("@batch");
      this.set({ ...this.value, pending: [...this.writes.keys()] });
    });
    this.writes.set("@batch", operation);
    this.set({ ...this.value, pending: [...this.writes.keys()], error: null });
    return operation;
  }
  private tracks(): MusicTrack[] {
    return [...this.entries.values()].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) ||
      a.musicTrack.trackId.localeCompare(b.musicTrack.trackId)).map((entry) => playlistTrack(entry.musicTrack, entry.forcedSourceTrackId));
  }
  private async readAll(signal: AbortSignal): Promise<Map<string, FavoriteEntry>> {
    for (let attempt = 0; ; ++attempt) {
      try {
        const entries = new Map<string, FavoriteEntry>();
        const cursors = new Set<string>();
        let cursor: string | null = null;
        let revision: string | null = null;
        do {
          const page = await this.api.page(cursor, signal);
          if (signal.aborted) throw new ApiError("CANCELLED", "Request cancelled");
          if (revision !== null && revision !== page.revision) throw new ApiError("CURSOR_EXPIRED", "Favorites revision changed", 410);
          revision = page.revision;
          page.items.forEach((entry) => entries.set(entry.musicTrack.trackId, entry));
          if (page.nextCursor && (page.nextCursor === cursor || cursors.has(page.nextCursor)))
            throw new ApiError("PAGINATION_STALLED", "Favorites pagination did not advance");
          if (cursor) cursors.add(cursor);
          cursor = page.nextCursor;
        } while (cursor);
        return entries;
      } catch (error) {
        if (attempt > 0 || signal.aborted || !(error instanceof ApiError) || error.code !== "CURSOR_EXPIRED" && error.status !== 410) throw error;
      }
    }
  }
}
