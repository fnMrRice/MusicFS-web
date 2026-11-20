import { ApiClient, ApiError } from "./client";
import type { SourceTrack } from "./types";
import { isLocalizedTitle, type LocalizedTitle } from "./localized-titles";

export interface CatalogArtist { artistId: string; name: string }
export interface CatalogAlbum { albumId: string; name: string }
export interface AlbumSourceLink { pluginId: string; url: string }
export interface MusicAlbum extends CatalogAlbum {
  originalName: string;
  revision: number;
  externalId: string | null;
  isExternal: boolean;
  coverPath: string | null;
  publisher: string | null;
  releaseDate: string | null;
  sourceLinks: AlbumSourceLink[];
}
export interface MusicTrack {
  trackId: string;
  title: string;
  revision?: number;
  localizedTitles?: LocalizedTitle[];
  artists: CatalogArtist[];
  albums: CatalogAlbum[];
  genre: string | null;
  year: number | null;
  rating: number | null;
  coverPath: string | null;
  selectedSource: SourceTrack | null;
  playlistEntryId?: string;
  playbackSelection?: { trackId: string; forcedSourceTrackId: string | null };
}
export interface MusicTrackPage {
  items: MusicTrack[];
  nextAfter: string | null;
  libraryRevision: string;
  matchingRevision: number;
}
export type MusicCategoryKind = "artist" | "album" | "genre";
export type MusicTrackQuery = { providerInstanceId?: string; artistId?: string; albumId?: string; genre?: string; unknown?: MusicCategoryKind; q?: string; sourceOnly?: boolean };
export interface MusicCategory { id: string; name: string; trackCount: number; coverPath?: string | null }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const text = (value: unknown): value is string => typeof value === "string";
const id = (value: unknown): value is string => text(value) && value.length > 0;
const nullableText = (value: unknown) => value === null || text(value);
function musicAlbum(value: unknown, albumId: string): value is MusicAlbum {
  return record(value) && value.albumId === albumId && text(value.name) && text(value.originalName) &&
    Number.isSafeInteger(value.revision) && Number(value.revision) > 0 && typeof value.isExternal === "boolean" &&
    ["externalId", "coverPath", "publisher", "releaseDate"].every((key) => nullableText(value[key])) &&
    Array.isArray(value.sourceLinks) && value.sourceLinks.every(link => record(link) && id(link.pluginId) && id(link.url)) &&
    new Set(value.sourceLinks.map(link => link.pluginId)).size === value.sourceLinks.length;
}
const source = (value: unknown): value is SourceTrack => record(value) && id(value.sourceTrackId) &&
  id(value.providerInstanceId) && text(value.displayName) && text(value.availability) &&
  (value.durationMs === null || typeof value.durationMs === "number");

export function musicTrack(value: unknown): value is MusicTrack {
  if (!record(value) || !id(value.trackId) || !id(value.title) || !nullableText(value.coverPath) ||
    (value.localizedTitles !== undefined && !(Array.isArray(value.localizedTitles) && value.localizedTitles.every(isLocalizedTitle))) ||
    !nullableText(value.genre) || !(value.year === null || Number.isSafeInteger(value.year)) ||
    !(value.rating === null || Number.isSafeInteger(value.rating)) ||
    !Array.isArray(value.artists) || !value.artists.every((a) => record(a) && id(a.artistId) && id(a.name)) ||
    !Array.isArray(value.albums) || !value.albums.every((a) => record(a) && id(a.albumId) && id(a.name))) return false;
  const selected = value.selectedSource;
  if (selected === null) return true;
  return source(selected) && Array.isArray(selected.versions) && selected.versions.every(source) &&
    selected.versions.some((v) => v.sourceTrackId === selected.sourceTrackId) &&
    new Set(selected.versions.map((v) => v.sourceTrackId)).size === selected.versions.length;
}

export class MusicCatalogApi {
  constructor(private client: ApiClient) {}

  async album(albumId: string, signal?: AbortSignal): Promise<MusicAlbum> {
    const value = await this.client.request<unknown>(`/library/albums/${encodeURIComponent(albumId)}`, { signal });
    if (!musicAlbum(value, albumId))
      throw new ApiError("INVALID_RESPONSE", "Invalid music album");
    return value;
  }

  async updateAlbum(album: MusicAlbum, changes: { name: string; publisher: string; releaseDate: string;
    sourceLinks?: AlbumSourceLink[] }, key: string) {
    const value = await this.client.request<unknown>(`/library/albums/${encodeURIComponent(album.albumId)}`, {
      method: "PUT", idempotencyKey: key, body: { expectedRevision: album.revision, name: changes.name,
        externalId: album.externalId, isExternal: album.isExternal, coverPath: album.coverPath,
        publisher: changes.publisher || null, releaseDate: changes.releaseDate || null,
        sourceLinks: changes.sourceLinks ?? album.sourceLinks },
    });
    if (!musicAlbum(value, album.albumId) || value.revision <= album.revision || value.originalName !== album.originalName)
      throw new ApiError("INVALID_RESPONSE", "Invalid updated music album");
    return value;
  }

  async track(id: string, signal?: AbortSignal, bySource = false): Promise<MusicTrack> {
    const path = bySource ? `/library/sources/${encodeURIComponent(id)}/track` : `/library/tracks/${encodeURIComponent(id)}`;
    const value = await this.client.request<unknown>(path, { signal });
    if (!musicTrack(value) || (!bySource && value.trackId !== id)) throw new ApiError("INVALID_RESPONSE", "Invalid music track");
    return value;
  }

  async tracks(query: MusicTrackQuery, after: string | null, signal?: AbortSignal): Promise<MusicTrackPage> {
    const params = new URLSearchParams({ limit: "100" });
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "" && !(key === "providerInstanceId" && value === "all")) params.set(key, String(value));
    }
    if (after) params.set("after", after);
    const page = await this.client.request<unknown>(`/library/tracks?${params}`, { signal });
    if (!record(page) || !Array.isArray(page.items) || !page.items.every(musicTrack) ||
      !id(page.libraryRevision) || !Number.isSafeInteger(page.matchingRevision) ||
      !(page.nextAfter === null || id(page.nextAfter))) throw new ApiError("INVALID_RESPONSE", "Invalid music catalog page");
    return page as unknown as MusicTrackPage;
  }

  async updateTrackTitles(track: MusicTrack, localizedTitles: LocalizedTitle[], key: string): Promise<void> {
    if (!Number.isSafeInteger(track.revision) || !track.revision)
      throw new ApiError("INVALID_RESPONSE", "Missing music track revision");
    const value = await this.client.request<unknown>(`/library/tracks/${encodeURIComponent(track.trackId)}`, {
      method: "PUT", idempotencyKey: key, body: {
        expectedRevision: track.revision, title: track.title, localizedTitles,
        artistNames: track.artists.map(artist => artist.name), albumIds: track.albums.map(album => album.albumId),
        coverPath: track.coverPath, genre: track.genre, year: track.year, rating: track.rating,
      },
    });
    if (!musicTrack(value) || value.trackId !== track.trackId || !value.revision || value.revision <= track.revision)
      throw new ApiError("INVALID_RESPONSE", "Invalid updated music track");
  }

  async createTrack(title: string, artistNames: string[], idempotencyKey: string): Promise<MusicTrack> {
    const result = await this.client.request<unknown>("/library/tracks", {
      method: "POST", idempotencyKey, body: { title, artistNames },
    });
    if (!musicTrack(result)) throw new ApiError("INVALID_RESPONSE", "Invalid music track");
    return result;
  }

  async categories(kind: MusicCategoryKind, provider: string, q: string, after: string | null, signal?: AbortSignal) {
    const params = new URLSearchParams({ limit: "100" });
    if (provider !== "all") params.set("providerInstanceId", provider);
    if (q) params.set("q", q);
    if (after) params.set("after", after);
    const page = await this.client.request<unknown>(`/library/${kind}s?${params}`, { signal });
    if (!record(page) || !Array.isArray(page.items) || !(page.nextAfter === null || id(page.nextAfter)))
      throw new ApiError("INVALID_RESPONSE", "Invalid music categories");
    const items: MusicCategory[] = page.items.map((item) => {
      const key = kind === "genre" ? "name" : `${kind}Id`;
      if (!record(item) || !text(item[key]) || !text(item.name) || !Number.isSafeInteger(item.trackCount) || Number(item.trackCount) < 0)
        throw new ApiError("INVALID_RESPONSE", "Invalid music category");
      if (kind === "album" && item.coverPath !== undefined && !nullableText(item.coverPath))
        throw new ApiError("INVALID_RESPONSE", "Invalid music album cover");
      return { id: item[key], name: item.name, trackCount: Number(item.trackCount),
        ...(kind === "album" && item.coverPath !== undefined ? { coverPath: item.coverPath as string | null } : {}) };
    });
    return { items, cursor: page.nextAfter };
  }

  async categoryName(kind: MusicCategoryKind, categoryId: string, signal?: AbortSignal): Promise<string> {
    if (kind === "genre") return categoryId;
    const item = await this.client.request<unknown>(`/library/${kind}s/${encodeURIComponent(categoryId)}`, { signal });
    if (!record(item) || item[`${kind}Id`] !== categoryId || !text(item.name))
      throw new ApiError("INVALID_RESPONSE", "Invalid music category");
    return item.name;
  }
}

// 播放与来源操作只接收真实来源，标题和署名取自曲目资料。
export function displaySource(item: MusicTrack | SourceTrack): SourceTrack | null {
  if (!("trackId" in item)) return item;
  if (!item.selectedSource) return null;
  return { ...item.selectedSource, playbackSelection: item.playbackSelection, title: item.title, artists: item.artists.map((a) => a.name),
    album: item.albums.map((a) => a.name).join(" / ") || null, genre: item.genre,
    coverObjectId: item.coverPath ? coverObject(item.coverPath) : item.selectedSource.coverObjectId };
}

export type TrackItem = MusicTrack | SourceTrack;
export const trackKey = (item: TrackItem) => "trackId" in item ? item.trackId : item.sourceTrackId;
export const tableRowKey = (item: TrackItem) => "trackId" in item && item.playlistEntryId ? item.playlistEntryId : trackKey(item);
export const trackTitle = (item: TrackItem) => "trackId" in item ? item.title : item.title || item.displayName;

export function playlistTrack(track: MusicTrack, forcedSourceTrackId: string | null): MusicTrack {
  const playbackSelection = { trackId: track.trackId, forcedSourceTrackId };
  if (!forcedSourceTrackId) return { ...track, playbackSelection };
  const group = track.selectedSource;
  const source = group?.versions?.find((version) => version.sourceTrackId === forcedSourceTrackId);
  return { ...track, playbackSelection, selectedSource: source && group ? { ...source,
    recordingId: group.recordingId, manualSourceTrackId: group.manualSourceTrackId, versions: group.versions } : null };
}

// 受鉴权媒体地址可在浏览器内读取，服务器文件路径只作为资料保存。
export function coverObject(path: string | null): string | null {
  return path?.match(/^\/api\/v1\/media\/([A-Za-z0-9_-]+)$/)?.[1] ?? null;
}
