import { ApiError } from "../../api/client";
import type { PlaylistEntry } from "../../api/content";
import type { SourceTrack } from "../../api/types";
import { playlistTrack, type TrackItem, type MusicTrack } from "../../api/music-catalog";

export interface ResolvedPlaylistEntry<T = TrackItem> extends PlaylistEntry { track: T | null }

// 歌单保存的是显式引用；读取独立于普通曲库分类，每页去重并限制同时请求数。
export function resolvePlaylistTracks(entries: PlaylistEntry[], load: (id: string) => Promise<SourceTrack>,
  signal: AbortSignal): Promise<ResolvedPlaylistEntry<SourceTrack>[]>;
export function resolvePlaylistTracks(entries: PlaylistEntry[], load: (id: string) => Promise<SourceTrack>,
  signal: AbortSignal, loadMusic: (id: string) => Promise<MusicTrack>): Promise<ResolvedPlaylistEntry[]>;
export async function resolvePlaylistTracks(entries: PlaylistEntry[], load: (id: string) => Promise<SourceTrack>,
  signal: AbortSignal, loadMusic?: (id: string) => Promise<MusicTrack>): Promise<ResolvedPlaylistEntry[]> {
  const sourceKey = ({source}: PlaylistEntry) => source.trackId ? `track:${source.trackId}`
    : source.sourceTrackId ? `source:${source.sourceTrackId}` : "";
  const ids = [...new Set(entries.map(sourceKey).filter(Boolean))];
  const tracks = await loadTrackMap<TrackItem | null>(ids, signal, (id) => {
    if (id.startsWith("source:")) return load(id.slice(7));
    return loadMusic ? loadMusic(id.slice(6)) : Promise.resolve(null);
  });
  return entries.map((entry) => {
    const track = tracks.get(sourceKey(entry));
    return { ...entry, track: track && "trackId" in track
      ? { ...playlistTrack(track, entry.source.forcedSourceTrackId ?? null), playlistEntryId: entry.entryId } : track ?? null };
  });
}

export async function loadTrackMap<T>(ids: readonly string[], signal: AbortSignal, load: (id: string) => Promise<T>) {
  const tracks = new Map<string, T>();
  let position = 0;
  async function worker() {
    while (position < ids.length) {
      signal.throwIfAborted();
      const id = ids[position++];
      try {
        tracks.set(id, await load(id));
      }
      catch (error) {
        if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 403)) throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
  signal.throwIfAborted();
  return tracks;
}
