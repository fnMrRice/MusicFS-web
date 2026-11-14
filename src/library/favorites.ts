import { ApiError, errorMessage } from "../api/client";
import type { FavoriteEntry, FavoritesApi } from "../api/favorites";
import { playlistTrack, trackKey, type MusicTrack, type TrackItem } from "../api/music-catalog";
import { Store } from "../app/store";

interface FavoritesSnapshot {
  items: MusicTrack[]; loaded: boolean; loading: boolean; error: string | null; pending: string[];
}
const initial = (): FavoritesSnapshot => ({ items: [], loaded: false, loading: false, error: null, pending: [] });

export class FavoritesState extends Store<FavoritesSnapshot> {
  private session: string | null = null;
  private generation = 0;
  private entries = new Map<string, FavoriteEntry>();
  private requests = new Set<AbortController>();
  private writes = new Map<string, Promise<void>>();
  private loading: Promise<void> | null = null;
  private changes: Map<string, FavoriteEntry | null> | null = null;
  constructor(private api: Pick<FavoritesApi, "page" | "add" | "remove">) { super(initial()); }
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
    this.changes = null;
    this.loading = null;
    this.session = null;
    this.set(initial());
  }
  private canonicalId(id: string): string {
    if (this.entries.has(id)) return id;
    for (const entry of this.entries.values()) {
      if (entry.musicTrack.selectedSource?.versions?.some((source) => source.sourceTrackId === id)) return entry.musicTrack.trackId;
    }
    return id;
  }
  has(id: string): boolean { return this.entries.has(this.canonicalId(id)); }
  load = (refresh = false): Promise<void> => {
    if (!this.session) return Promise.resolve();
    if (this.loading) return this.loading;
    if (this.value.loaded && !refresh) return Promise.resolve();
    const generation = this.generation;
    const request = new AbortController();
    this.requests.add(request);
    const changes = new Map<string, FavoriteEntry | null>();
    this.changes = changes;
    this.set({ ...this.value, loading: true, error: null });
    const loading = this.readAll(request.signal).then((entries) => {
      if (generation !== this.generation) return;
      // 读取期间完成的写入已由服务端确认，不能被较早的列表快照覆盖。
      changes.forEach((entry, id) => { if (entry) entries.set(id, entry); else entries.delete(id); });
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
    const previous = this.writes.get(id) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      if (generation !== this.generation) return;
      const request = new AbortController();
      this.requests.add(request);
      try {
        const entry = favorite ? await this.api.add(id, request.signal, forcedSourceTrackId) : (await this.api.remove(id, request.signal), null);
        if (generation !== this.generation) return;
        const canonicalId = entry?.musicTrack.trackId ?? this.canonicalId(id);
        if (entry) this.entries.set(canonicalId, entry); else this.entries.delete(canonicalId);
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
