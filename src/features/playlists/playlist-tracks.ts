import { ApiError } from "../../api/client";
import type { PlaylistEntry } from "../../api/content";
import type { SourceTrack } from "../../api/types";

export interface ResolvedPlaylistEntry extends PlaylistEntry { track: SourceTrack | null }

// 歌单保存的是显式引用；读取独立于普通曲库分类，每页去重并限制同时请求数。
export async function resolvePlaylistTracks(entries: PlaylistEntry[], load: (id: string) => Promise<SourceTrack>,
  signal: AbortSignal): Promise<ResolvedPlaylistEntry[]> {
  const ids = [...new Set(entries.flatMap((entry) => entry.source.sourceTrackId ? [entry.source.sourceTrackId] : []))];
  const tracks = new Map<string, SourceTrack>();
  let position = 0;
  async function worker() {
    while (position < ids.length) {
      signal.throwIfAborted();
      const id = ids[position++];
      try { tracks.set(id, await load(id)); }
      catch (error) {
        if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 403)) throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
  signal.throwIfAborted();
  return entries.map((entry) => ({ ...entry, track: tracks.get(entry.source.sourceTrackId ?? "") ?? null }));
}
