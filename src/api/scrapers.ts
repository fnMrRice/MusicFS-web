import { ApiClient, ApiError, errorMessage, withRequestId } from "./client";
import { isLocalizedTitle, type LocalizedTitle } from "./localized-titles";

export function scraperSearchMessage(error: unknown, sources?: readonly Scraper[]): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const failure = error.scraper;
  if (!failure && error.status !== 429 && error.code !== "RATE_LIMITED") return errorMessage(error);
  const platform = sources?.find(item => item.pluginId === failure?.pluginId)?.name || failure?.pluginId || "资料平台";
  let reason = `资料查询受到限制（HTTP ${error.status}）。`;
  if (failure?.reason === "busy") reason = `MusicFS 同时进行的资料查询过多，本次未向 ${platform} 发送请求。`;
  if (failure?.reason === "upstream") {
    reason = failure.upstreamStatus === 429 ? `${platform} 返回 HTTP 429（请求过多）。`
      : failure.upstreamStatus === 503 ? `${platform} 返回 HTTP 503（服务暂不可用）。`
      : failure.upstreamStatus ? `${platform} 返回 HTTP ${failure.upstreamStatus}。` : `${platform} 未能完成资料查询。`;
  }
  if (failure?.reason === "cooldown") reason = failure.upstreamStatus
    ? `${platform} 此前返回 HTTP ${failure.upstreamStatus}，仍在等待期，本次未向平台发送请求。`
    : `${platform} 仍在等待期，本次未向平台发送请求。`;
  const wait = error.retryAfter;
  const hint = wait !== undefined && Number.isSafeInteger(wait) && wait >= 0
    ? `${reason} 可在 ${wait} 秒后重试。` : reason;
  return withRequestId(hint, error);
}

export interface Scraper {
  pluginId: string;
  name: string;
  type: "scraper";
  available: boolean;
  fields: string[];
  externalIdNamespace?: string;
  requiresExternalId?: boolean;
}

export interface ScraperQuery {
  title?: string;
  artist?: string;
  album?: string;
  externalId?: string;
  country?: string;
  fingerprint?: string;
  duration?: number;
  sourceUrl?: string;
}

export interface ScrapedTrack {
  externalId?: string;
  title: string;
  localizedTitles?: LocalizedTitle[];
  localizedArtistNames?: LocalizedTitle[];
  artist?: string;
  composer?: string;
  disc?: number;
  number?: number;
  duration?: number;
}

export interface ScrapedItem {
  id: string;
  title: string;
  localizedTitles?: LocalizedTitle[];
  localizedArtistNames?: LocalizedTitle[];
  artist?: string;
  album?: string;
  date?: string;
  description?: string;
  genre?: string;
  publisher?: string;
  sourceUrl?: string;
  imageUrl?: string;
  lyrics?: string;
  format?: string;
  duration?: number;
  tracks?: ScrapedTrack[];
}
export interface ScrapeCandidate extends ScrapedItem { candidateToken: string }
export interface SavedScrapedField { field: string; pluginId: string; item: ScrapedItem }
export type AlbumMergeField = "name" | "artist" | "releaseDate" | "publisher" | "genre" | "description" | "cover" | "tracks";
export interface TrackMediaSelection {
  target: { sourceTrackId: string; assetId: string; assetVersion: string };
  revision: number;
}

function record(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === "object" && !Array.isArray(item);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function numeric(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isTrack(value: unknown): value is ScrapedTrack {
  return record(value) && typeof value.title === "string" &&
    (value.externalId === undefined || nonempty(value.externalId)) &&
    (value.localizedTitles === undefined || Array.isArray(value.localizedTitles) && value.localizedTitles.every(isLocalizedTitle)) &&
    (value.localizedArtistNames === undefined || Array.isArray(value.localizedArtistNames) && value.localizedArtistNames.every(isLocalizedTitle)) &&
    (value.artist === undefined || typeof value.artist === "string") &&
    (value.composer === undefined || typeof value.composer === "string") &&
    ["disc", "number", "duration"].every((key) => value[key] === undefined || numeric(value[key]));
}
function isItem(value: unknown): value is ScrapedItem {
  return record(value) && nonempty(value.id) && typeof value.title === "string" &&
    (value.localizedArtistNames === undefined || Array.isArray(value.localizedArtistNames) && value.localizedArtistNames.every(isLocalizedTitle)) &&
    (value.localizedTitles === undefined || Array.isArray(value.localizedTitles) && value.localizedTitles.every(isLocalizedTitle)) &&
    ["artist", "album", "date", "description", "genre", "publisher", "sourceUrl", "imageUrl", "lyrics", "format"]
      .every((key) => value[key] === undefined || typeof value[key] === "string") &&
    (value.duration === undefined || numeric(value.duration)) &&
    (value.tracks === undefined || Array.isArray(value.tracks) && value.tracks.every(isTrack));
}
function isScraper(value: unknown): value is Scraper {
  return record(value) && nonempty(value.pluginId) && nonempty(value.name) && value.type === "scraper" &&
    typeof value.available === "boolean" && Array.isArray(value.fields) && value.fields.every(nonempty) &&
    (value.externalIdNamespace === undefined || nonempty(value.externalIdNamespace)) &&
    (value.requiresExternalId === undefined || typeof value.requiresExternalId === "boolean");
}
function items<T>(value: unknown, valid: (value: unknown) => value is T): T[] {
  if (!record(value) || !Array.isArray(value.items) || !value.items.every(valid))
    throw new ApiError("INVALID_RESPONSE", "Invalid scraper response");
  return value.items;
}
function trackSelection(value: unknown, trackId: string): TrackMediaSelection {
  if (!record(value) || !record(value.target) || value.target.sourceTrackId !== trackId ||
    !nonempty(value.target.assetId) || !nonempty(value.target.assetVersion) ||
    !Number.isSafeInteger(value.revision) || Number(value.revision) < 0)
    throw new ApiError("INVALID_RESPONSE", "Invalid track media selection");
  return { target: { sourceTrackId: trackId, assetId: value.target.assetId, assetVersion: value.target.assetVersion },
    revision: Number(value.revision) };
}
export class ScrapersApi {
  constructor(private client: ApiClient) {}
  async list(signal?: AbortSignal): Promise<Scraper[]> {
    return items(await this.client.request<unknown>("/scrapers", { signal }), isScraper);
  }
  async search(pluginId: string, field: string, query: ScraperQuery, signal?: AbortSignal, refresh = false): Promise<ScrapeCandidate[]> {
    const result = await this.client.request<unknown>(`/scrapers/${encodeURIComponent(pluginId)}/search`,
      { method: "POST", body: { field, query, ...(refresh ? { refresh: true } : {}) }, signal, timeoutMs: 45_000 });
    return items(result, (item): item is ScrapeCandidate =>
      isItem(item) && "candidateToken" in item && nonempty(item.candidateToken));
  }
  async saved(workId: string, signal?: AbortSignal): Promise<SavedScrapedField[]> {
    const result = await this.client.request<unknown>(`/works/${encodeURIComponent(workId)}/scraped-fields`, { signal });
    return items(result, (entry): entry is SavedScrapedField => record(entry) && nonempty(entry.field) &&
      nonempty(entry.pluginId) && isItem(entry.item));
  }
  async savedAlbum(albumId: string, signal?: AbortSignal): Promise<SavedScrapedField[]> {
    const result = await this.client.request<unknown>(`/library/albums/${encodeURIComponent(albumId)}/scraped-fields`, { signal });
    return items(result, (entry): entry is SavedScrapedField => record(entry) && nonempty(entry.field) &&
      ["albumDetails", "albumTracks", "artwork"].includes(entry.field) &&
      nonempty(entry.pluginId) && isItem(entry.item));
  }
  async clearAlbum(albumId: string, expectedRevision: number, key: string): Promise<void> {
    const result = await this.client.request<unknown>(`/library/albums/${encodeURIComponent(albumId)}/scraped-fields`, {
      method: "DELETE", body: { expectedRevision }, idempotencyKey: key,
    });
    if (!record(result) || !Number.isSafeInteger(result.revision) || Number(result.revision) < expectedRevision)
      throw new ApiError("INVALID_RESPONSE", "Invalid cleared album revision");
  }
  async applyAlbum(albumId: string, field: string, expectedRevision: number, pluginId: string, candidateToken: string, key: string) {
    const result = await this.client.request<unknown>(`/library/albums/${encodeURIComponent(albumId)}/scraped-fields/${encodeURIComponent(field)}`,
      { method: "PUT", body: { expectedRevision, pluginId, candidateToken }, idempotencyKey: key });
    if (!record(result) || !Number.isSafeInteger(result.revision) || Number(result.revision) <= expectedRevision)
      throw new ApiError("INVALID_RESPONSE", "Invalid album scraped field revision");
  }
  async applyAlbumBundle(albumId: string, expectedRevision: number, pluginId: string,
    candidates: { albumDetails: string; albumTracks: string }, key: string) {
    const result = await this.client.request<unknown>(`/library/albums/${encodeURIComponent(albumId)}/scraped-fields`,
      { method: "PUT", body: { expectedRevision, pluginId, candidates }, idempotencyKey: key });
    if (!record(result) || !Number.isSafeInteger(result.revision) || Number(result.revision) <= expectedRevision)
      throw new ApiError("INVALID_RESPONSE", "Invalid complete album revision");
  }
  async mergeAlbumMetadata(albumId: string, expectedRevision: number, pluginId: string,
    candidates: { albumDetails: string; albumTracks: string }, fields: AlbumMergeField[], key: string) {
    const result = await this.client.request<unknown>(`/library/albums/${encodeURIComponent(albumId)}/metadata-merge`,
      { method: "PUT", body: { expectedRevision, pluginId, candidates, fields }, idempotencyKey: key });
    if (!record(result) || !Number.isSafeInteger(result.revision) || Number(result.revision) <= expectedRevision)
      throw new ApiError("INVALID_RESPONSE", "Invalid merged album revision");
  }
  async apply(workId: string, field: string, expectedRevision: number, pluginId: string, candidateToken: string, key: string) {
    const result = await this.client.request<unknown>(`/works/${encodeURIComponent(workId)}/scraped-fields/${encodeURIComponent(field)}`,
      { method: "PUT", body: { expectedRevision, pluginId, candidateToken }, idempotencyKey: key });
    if (!record(result) || !Number.isSafeInteger(result.revision) || Number(result.revision) <= expectedRevision)
      throw new ApiError("INVALID_RESPONSE", "Invalid scraped field revision");
  }
  async trackTarget(trackId: string, signal?: AbortSignal) {
    return trackSelection(await this.client.request<unknown>(`/source-tracks/${encodeURIComponent(trackId)}/media-selection`, { signal }), trackId);
  }
  async applyMedia(selection: TrackMediaSelection, field: string, pluginId: string, candidateToken: string, key: string) {
    const { sourceTrackId, assetId, assetVersion } = selection.target;
    const value = await this.client.request<unknown>(`/source-tracks/${encodeURIComponent(sourceTrackId)}/scraped-fields/${encodeURIComponent(field)}`,
      { method: "PUT", body: { expectedRevision: selection.revision, assetId, assetVersion, pluginId, candidateToken }, idempotencyKey: key });
    const next = trackSelection(value, sourceTrackId);
    if (next.target.assetId !== assetId || next.target.assetVersion !== assetVersion || next.revision <= selection.revision)
      throw new ApiError("INVALID_RESPONSE", "Unexpected scraped media selection");
  }
}
