import { ApiClient, ApiError } from "./client";
import type { SourceTrack } from "./types";

export interface TrackSelection {
  batch: boolean;
  sourceTrackIds?: string[];
  exclude?: string[];
  providerInstanceId?: string;
  groupBy?: "recording";
  libraryRevision?: string;
  matchingRevision?: number;
}
export interface SelectedTracks { items: SourceTrack[]; total: number }
export interface SelectionPlaylistResult { playlistId: string; ruleRevision: number; count: number }

const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 &&
  new TextEncoder().encode(value).length <= 128 && !/[\p{White_Space}\p{Cc}\uD800-\uDFFF]/u.test(value);
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100000 &&
  value.every(id) && new Set(value).size === value.length;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const revision = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;

/** 校验恢复的选择范围，禁止把批量选择与明确的 ID 列表混用。 */
export function isTrackSelection(value: unknown): value is TrackSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as TrackSelection;
  return typeof selection.batch === "boolean" &&
    (selection.batch ? revision(selection.libraryRevision) && selection.sourceTrackIds === undefined && (selection.exclude === undefined || ids(selection.exclude)) :
      ids(selection.sourceTrackIds) && selection.sourceTrackIds.length > 0 && selection.exclude === undefined) &&
    (selection.providerInstanceId === undefined || id(selection.providerInstanceId)) &&
    (selection.groupBy === undefined || selection.groupBy === "recording" && count(selection.matchingRevision)) &&
    (selection.libraryRevision === undefined || revision(selection.libraryRevision)) &&
    (selection.matchingRevision === undefined || count(selection.matchingRevision));
}

export class TrackSelectionApi {
  constructor(private client: ApiClient) {}

  async resolve(selection: TrackSelection, signal?: AbortSignal): Promise<SelectedTracks> {
    const result = await this.client.request<SelectedTracks>("/source-tracks/selection", { method: "POST", body: selection, signal });
    if (!result || !count(result.total) || !Array.isArray(result.items) || result.total !== result.items.length || result.items.some((track) =>
      !track || !id(track.sourceTrackId) || !id(track.providerInstanceId) || typeof track.displayName !== "string" ||
      typeof track.availability !== "string" || (track.durationMs !== null && !count(track.durationMs))) ||
      new Set(result.items.map((track) => track.sourceTrackId)).size !== result.items.length)
      throw new ApiError("INVALID_RESPONSE", "Invalid track selection response");
    return result;
  }

  async favorite(selection: TrackSelection, favorite: boolean, signal?: AbortSignal): Promise<{ affected: number; sourceTrackIds: string[] }> {
    const result = await this.write<{ affected: number; sourceTrackIds: string[] }>("/me/favorites/batch", { selection, favorite }, crypto.randomUUID(), signal);
    if (!result || !count(result.affected) || !ids(result.sourceTrackIds)) throw new ApiError("INVALID_RESPONSE", "Invalid batch favorite response");
    return result;
  }

  createPlaylist(selection: TrackSelection, name: string, key: string = crypto.randomUUID()): Promise<SelectionPlaylistResult> {
    return this.playlist("/playlists/selection", { selection, name }, key);
  }

  appendPlaylist(playlistId: string, selection: TrackSelection, expectedRevision: number, key: string = crypto.randomUUID()): Promise<SelectionPlaylistResult> {
    return this.playlist(`/playlists/${encodeURIComponent(playlistId)}/selection`, { selection, expectedRevision }, key);
  }

  private async playlist(path: string, body: unknown, key: string): Promise<SelectionPlaylistResult> {
    const result = await this.write<SelectionPlaylistResult>(path, body, key);
    if (!result || !id(result.playlistId) || !count(result.ruleRevision) || !count(result.count))
      throw new ApiError("INVALID_RESPONSE", "Invalid selection playlist response");
    return result;
  }

  private async write<T>(path: string, body: unknown, idempotencyKey: string, signal?: AbortSignal): Promise<T> {
    const options = { method: "POST", body, idempotencyKey, signal };
    try { return await this.client.request<T>(path, options); }
    catch (error) {
      if (!(error instanceof ApiError) || !["TIMEOUT", "NETWORK_ERROR"].includes(error.code) || signal?.aborted) throw error;
      return this.client.request<T>(path, options);
    }
  }
}
