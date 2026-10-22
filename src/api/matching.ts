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
export interface BulkMergeMutation extends MatchingMutation { mergedGroups: number; mergedSources: number; skippedGroups: number }
export type BulkMergeMode = "score" | "title_artist";
export interface MatchingRevision { revision: number; bulkMergeAvailable?: boolean }
export type MatchingRequest =
  | { kind: "bulk-merge"; expectedRevision: number; mode: BulkMergeMode; minimumScore?: number }
  | { kind: "links"; expectedRevision: number; sourceTrackIds: string[]; targetRecordingId: string | null }
  | { kind: "unlinks"; expectedRevision: number; sourceTrackId: string }
  | { kind: "default-source"; expectedRevision: number; recordingId: string; sourceTrackId: string | null }
  | { kind: "exclusions"; expectedRevision: number; leftSourceTrackId: string; rightSourceTrackId: string; excluded: boolean };

export function bulkMergeRequest(mode: BulkMergeMode, revision: number, minimumScore = 80): MatchingRequest {
  if (mode === "score" && (!Number.isInteger(minimumScore) || minimumScore < 0 || minimumScore > 100))
    throw new ApiError("INVALID_SCORE", "Minimum score must be an integer between 0 and 100");
  return { kind: "bulk-merge", expectedRevision: revision, mode, ...(mode === "score" ? { minimumScore } : {}) };
}

export function isBulkMergeMutation(result: MatchingMutation): result is BulkMergeMutation {
  const bulk = result as BulkMergeMutation;
  return [bulk.mergedGroups, bulk.mergedSources, bulk.skippedGroups].every((value) => Number.isSafeInteger(value) && value >= 0);
}

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
  async revision(signal?: AbortSignal): Promise<MatchingRevision> {
    const result = await this.client.request<MatchingRevision>("/matching/revision", { signal });
    if (!result || !Number.isSafeInteger(result.revision) || result.revision < 0 ||
      (result.bulkMergeAvailable !== undefined && typeof result.bulkMergeAvailable !== "boolean"))
      throw new ApiError("INVALID_RESPONSE", "Invalid matching revision");
    return result;
  }
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
  async mutate(request: MatchingRequest, key: string, signal?: AbortSignal): Promise<MatchingMutation> {
    const { kind, ...body } = request;
    const result = await this.client.request<MatchingMutation>(`/matching/${kind}`, { method: "POST", body, idempotencyKey: key, signal });
    if (kind === "default-source" && (!result || !Number.isSafeInteger(result.revision) || result.revision < 0 ||
      typeof result.operationId !== "string" || !result.operationId || result.recordingId !== request.recordingId))
      throw new ApiError("INVALID_RESPONSE", "Invalid default source result");
    if (kind === "bulk-merge" && (!result || !isBulkMergeMutation(result) || !Number.isSafeInteger(result.revision) ||
      result.revision < 0 || typeof result.operationId !== "string" || !result.operationId || result.recordingId !== null))
      throw new ApiError("INVALID_RESPONSE", "Invalid bulk merge result");
    return result;
  }
}
