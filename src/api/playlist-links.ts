import { ApiClient, ApiError } from "./client";
import { withRateLimitRetry } from "./rate-limit";
import type { OnlineTrack } from "./content";

export interface PlaylistLink {
  platform: string;
  instanceId: string;
  accountId: string;
  externalId: string;
  playlistId: string;
  pendingCount: number;
  lastErrorCode?: string;
}
export type PlaylistLinkTarget = Pick<PlaylistLink, "instanceId" | "accountId" | "externalId">;

function validLink(link: PlaylistLink): boolean {
  return !!link && [link.platform, link.instanceId, link.accountId, link.externalId, link.playlistId].every(
    (value) => typeof value === "string" && value.length > 0)
    && Number.isSafeInteger(link.pendingCount) && link.pendingCount >= 0;
}
export async function playlistLinks(client: ApiClient, signal: AbortSignal): Promise<PlaylistLink[]> {
  const result = await client.request<{ items: PlaylistLink[] }>("/playlist-links", { signal });
  if (!Array.isArray(result?.items) || !result.items.every(validLink))
    throw new ApiError("INVALID_RESPONSE", "Invalid playlist links");
  return result.items;
}
export async function changePlaylistLink(client: ApiClient, target: PlaylistLinkTarget, playlistId: string, remove: boolean, signal: AbortSignal) {
  const { instanceId, externalId, accountId } = target;
  const path = `/online-instances/${encodeURIComponent(instanceId)}/playlists/${encodeURIComponent(externalId)}/link`;
  const result = await withRateLimitRetry(() => client.request<PlaylistLink | undefined>(path, {
    method: remove ? "DELETE" : "PUT", body: { accountId, playlistId }, signal,
  }), signal);
  if (!remove && (!result || !validLink(result) || result.accountId !== accountId || result.externalId !== externalId
      || result.instanceId !== instanceId || result.playlistId !== playlistId))
    throw new ApiError("INVALID_RESPONSE", "Invalid playlist link");
}

export interface OnlinePlaylistSelection {
  instanceId: string;
  accountId: string;
  tracks: OnlineTrack[];
}
export async function remotePlaylistEntries(client: ApiClient, selection: OnlinePlaylistSelection, signal: AbortSignal) {
  const path = `/online-instances/${encodeURIComponent(selection.instanceId)}/playlist-track-sources`;
  const entries = [];
  for (let offset = 0; offset < selection.tracks.length; offset += 50) {
    const externalIds = selection.tracks.slice(offset, offset + 50).map((track) => track.externalId);
    const result = await withRateLimitRetry(() => client.request<{ items: { remoteSourceId: string }[] }>(path, {
      method: "POST", body: { accountId: selection.accountId, externalIds }, signal,
    }), signal);
    if (!Array.isArray(result?.items) || result.items.length !== externalIds.length ||
        !result.items.every((item) => typeof item?.remoteSourceId === "string" && item.remoteSourceId))
      throw new ApiError("INVALID_RESPONSE", "Invalid remote playlist sources");
    entries.push(...result.items.map(({ remoteSourceId }) => ({ source: { remoteSourceId, sourceTrackId: null } })));
  }
  return entries;
}
