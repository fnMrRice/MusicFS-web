import { ApiClient, ApiError } from "./client";
import type { SourceTrack } from "./types";

export interface MatchCandidate {
  candidateId: string;
  left: { sourceTrackId: string };
  right: { sourceTrackId: string };
  leftTrack: SourceTrack;
  rightTrack: SourceTrack;
  score: number;
  reasons: { kind: string; durationDifferenceMs?: number }[];
  status: string;
}
export interface CandidatePage { items: MatchCandidate[]; revision: number; nextAfter: string | null }
export interface MatchingMutation { revision: number; operationId: string; recordingId: string | null }
export type MatchingRequest =
  | { kind: "links"; expectedRevision: number; sourceTrackIds: string[]; targetRecordingId: string | null }
  | { kind: "unlinks"; expectedRevision: number; sourceTrackId: string }
  | { kind: "exclusions"; expectedRevision: number; leftSourceTrackId: string; rightSourceTrackId: string; excluded: boolean };

export function selectedVersions(tracks: SourceTrack[]): SourceTrack[] {
  return [...new Map(tracks.flatMap((track) => track.versions?.length ? track.versions : [track])
    .map((track) => [track.sourceTrackId, track])).values()];
}

export function mergeRequest(tracks: SourceTrack[], revision: number): MatchingRequest {
  const sources = selectedVersions(tracks);
  if (sources.length < 2 || sources.length > 256)
    throw new ApiError("MATCHING_SELECTION_LIMIT", "Select between 2 and 256 source tracks");
  return {
    kind: "links", expectedRevision: revision, sourceTrackIds: sources.map((track) => track.sourceTrackId),
    targetRecordingId: tracks.find((track) => track.recordingId)?.recordingId ?? null,
  };
}

export class MatchingApi {
  constructor(private client: ApiClient) {}
  revision(signal?: AbortSignal) { return this.client.request<{ revision: number }>("/matching/revision", { signal }); }
  async candidates(after: string | null, signal?: AbortSignal): Promise<CandidatePage> {
    const query = new URLSearchParams({ limit: "20" });
    if (after) query.set("after", after);
    const page = await this.client.request<CandidatePage>(`/matching/candidates?${query}`, { signal });
    if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.revision) || page.revision < 0 ||
      (page.nextAfter !== null && typeof page.nextAfter !== "string") || page.items.some((item) =>
        !item || typeof item.candidateId !== "string" || !item.leftTrack || !item.rightTrack || !item.left || !item.right ||
        item.leftTrack.sourceTrackId !== item.left.sourceTrackId || item.rightTrack.sourceTrackId !== item.right.sourceTrackId ||
        typeof item.score !== "number" || !Array.isArray(item.reasons)))
      throw new ApiError("INVALID_RESPONSE", "Invalid matching candidates");
    return page;
  }
  mutate(request: MatchingRequest, key: string, signal?: AbortSignal): Promise<MatchingMutation> {
    const { kind, ...body } = request;
    return this.client.request(`/matching/${kind}`, { method: "POST", body, idempotencyKey: key, signal });
  }
}
