import { ApiClient, ApiError } from "./client";

export interface RecordingCoverCandidate {
  objectId: string; sourceTrackId: string; providerInstanceId: string; width: number; height: number;
}
export interface RecordingCover {
  recordingId: string; revision: number; coverObjectId: string | null; manualObjectId: string | null;
  candidates: RecordingCoverCandidate[];
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function checked(value: unknown, recordingId: string): RecordingCover {
  if (!record(value) || value.recordingId !== recordingId || !integer(value.revision) ||
    !(value.coverObjectId === null || id(value.coverObjectId)) || !(value.manualObjectId === null || id(value.manualObjectId)) ||
    !Array.isArray(value.candidates) || value.candidates.some((item) => !record(item) || !id(item.objectId) ||
      !id(item.sourceTrackId) || !id(item.providerInstanceId) || !integer(item.width) || !integer(item.height)))
    throw new ApiError("INVALID_RESPONSE", "Invalid recording cover response");
  const candidates = value.candidates as RecordingCoverCandidate[];
  if (new Set(candidates.map((candidate) => candidate.objectId)).size !== candidates.length ||
    value.coverObjectId !== null && !candidates.some((candidate) => candidate.objectId === value.coverObjectId))
    throw new ApiError("INVALID_RESPONSE", "Recording cover is outside its candidates");
  return value as unknown as RecordingCover;
}

export class RecordingCoverApi {
  constructor(private client: ApiClient) {}
  async get(recordingId: string, signal?: AbortSignal): Promise<RecordingCover> {
    return checked(await this.client.request(`/recordings/${encodeURIComponent(recordingId)}/cover`, { signal }), recordingId);
  }
  async select(recordingId: string, expectedRevision: number, objectId: string | null, key: string): Promise<RecordingCover> {
    if (!id(recordingId) || !integer(expectedRevision) || !(objectId === null || id(objectId)) || !id(key))
      throw new ApiError("INVALID_ARGUMENT", "Invalid recording cover selection");
    return checked(await this.client.request(`/recordings/${encodeURIComponent(recordingId)}/cover`, {
      method: "PUT", body: { expectedRevision, objectId }, idempotencyKey: key,
    }), recordingId);
  }
}
