import { ApiClient, ApiError } from "./client";
import type { SourceTrack } from "./types";
import { musicTrack, type MusicTrack } from "./music-catalog";

export interface FavoriteEntry { musicTrack: MusicTrack; track: SourceTrack | null; recordedAt: string; forcedSourceTrackId: string | null }
export interface FavoritePage { items: FavoriteEntry[]; nextCursor: string | null; revision: string }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown) => value === null || text(value);
function entry(value: unknown): value is FavoriteEntry {
  if (!object(value) || !text(value.recordedAt) || !Number.isFinite(Date.parse(value.recordedAt)) ||
    !nullableText(value.forcedSourceTrackId) || !musicTrack(value.musicTrack)) return false;
  if (value.track === null) return true;
  if (!object(value.track)) return false;
  const track = value.track;
  return text(track.sourceTrackId) && !!track.sourceTrackId && text(track.providerInstanceId) && text(track.displayName) &&
    text(track.availability) && nullableText(track.title) &&
    (track.artists === null || Array.isArray(track.artists) && track.artists.every(text)) &&
    (track.durationMs === null || typeof track.durationMs === "number" && Number.isFinite(track.durationMs)) &&
    (track.coverObjectId === undefined || nullableText(track.coverObjectId));
}

export class FavoritesApi {
  constructor(private client: ApiClient) {}
  async page(cursor: string | null = null, signal?: AbortSignal): Promise<FavoritePage> {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const value = await this.client.request<unknown>(`/me/favorites?${params}`, { signal });
    if (!object(value) || !Array.isArray(value.items) || !value.items.every(entry) ||
      !nullableText(value.nextCursor) || !text(value.revision) || !value.revision)
      throw new ApiError("INVALID_RESPONSE", "Invalid favorites page");
    return value as unknown as FavoritePage;
  }
  async add(sourceTrackId: string, signal?: AbortSignal, forcedSourceTrackId?: string | null): Promise<FavoriteEntry> {
    const value = await this.client.request<unknown>(`/me/favorites/${encodeURIComponent(sourceTrackId)}`, {
      method: "PUT", signal, body: forcedSourceTrackId === undefined ? undefined : { forcedSourceTrackId },
    });
    if (!entry(value) || value.musicTrack.trackId !== sourceTrackId &&
      !value.musicTrack.selectedSource?.versions?.some((version) => version.sourceTrackId === sourceTrackId))
      throw new ApiError("INVALID_RESPONSE", "Invalid favorite entry");
    return value;
  }
  remove(sourceTrackId: string, signal?: AbortSignal): Promise<void> {
    return this.client.request(`/me/favorites/${encodeURIComponent(sourceTrackId)}`, { method: "DELETE", signal });
  }
}
