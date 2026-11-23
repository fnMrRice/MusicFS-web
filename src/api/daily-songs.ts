import { ApiClient, ApiError } from "./client";
import type { OnlineTrack } from "./content";
import { withRateLimitRetry } from "./rate-limit";

export async function dailySongs(client: ApiClient, instance: string, signal: AbortSignal): Promise<OnlineTrack[]> {
  const page = await withRateLimitRetry(() => client.request<{ tracks: OnlineTrack[]; observedAt: string }>(
    `/online-instances/${encodeURIComponent(instance)}/daily-songs?limit=50`, { signal },
  ), signal);
  if (!page || !Array.isArray(page.tracks) || page.tracks.length > 50 ||
      typeof page.observedAt !== "string" || !Number.isFinite(Date.parse(page.observedAt)) ||
      !page.tracks.every((track) => track && typeof track.externalId === "string" && track.externalId &&
        typeof track.title === "string" && track.title && Array.isArray(track.artists) &&
        track.artists.every((artist) => typeof artist === "string") &&
        (track.durationMs === null || (Number.isSafeInteger(track.durationMs) && track.durationMs >= 0)))) {
    throw new ApiError("INVALID_RESPONSE", "Invalid daily song recommendations");
  }
  return page.tracks;
}
