import { ApiClient, ApiError } from "./client";

export interface TrackDetailField { id: string; label: string; value: string }
export interface TrackDetailSection { id: string; title: string; fields: TrackDetailField[] }
export interface TrackDetails {
  sourceTrackId: string;
  providerInstanceId: string;
  externalId: string;
  title: string;
  sections: TrackDetailSection[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validSections(value: unknown): value is TrackDetailSection[] {
  if (!Array.isArray(value)) return false;
  const sectionIds = new Set<string>();
  return value.every((section) => {
    if (!record(section) || typeof section.id !== "string" || !section.id || sectionIds.has(section.id) ||
      typeof section.title !== "string" || !Array.isArray(section.fields)) return false;
    sectionIds.add(section.id);
    const fieldIds = new Set<string>();
    return section.fields.every((field) => {
      if (!record(field) || typeof field.id !== "string" || !field.id || fieldIds.has(field.id) ||
        typeof field.label !== "string" || typeof field.value !== "string") return false;
      fieldIds.add(field.id);
      return true;
    });
  });
}

export class TrackDetailsApi {
  constructor(private client: ApiClient) {}
  async get(sourceTrackId: string, providerInstanceId: string, signal?: AbortSignal): Promise<TrackDetails> {
    let result: unknown;
    try {
      result = await this.client.request<unknown>(`/source-tracks/${encodeURIComponent(sourceTrackId)}/details`, { signal });
    } catch (error) {
      if (error instanceof ApiError && error.code === "RESOURCE_CHANGED")
        throw new ApiError("SOURCE_TRACK_CHANGED", error.message, error.status, error.requestId, error.retryAfter);
      throw error;
    }
    if (!record(result) || result.sourceTrackId !== sourceTrackId || result.providerInstanceId !== providerInstanceId ||
      typeof result.externalId !== "string" || !result.externalId || typeof result.title !== "string" || !validSections(result.sections))
      throw new ApiError("INVALID_RESPONSE", "Invalid source track details");
    return result as unknown as TrackDetails;
  }
}
