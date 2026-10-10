import { ApiClient, ApiError } from "./client";
import type { Provider, SourceTrack, TrackPage } from "./types";
import { Store } from "../app/store";

function isTrack(value: SourceTrack): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.sourceTrackId === "string" &&
    typeof value.providerInstanceId === "string" &&
    typeof value.displayName === "string" &&
    typeof value.availability === "string" &&
    (value.durationMs === null || typeof value.durationMs === "number")
  );
}
export class LibraryApi {
  readonly providerInstances = new Store<Provider[]>([]);
  private providerEpoch = 0;
  private providerRequest = 0;
  private providerApplied = 0;
  constructor(private client: ApiClient) {}
  clearProviderInstances(): void {
    ++this.providerEpoch;
    this.providerInstances.set([]);
  }
  async providers(signal?: AbortSignal): Promise<Provider[]> {
    const epoch = this.providerEpoch;
    const request = ++this.providerRequest;
    const response = await this.client.request<{ items: Provider[] }>(
      "/provider-instances",
      { signal },
    );
    if (
      !response ||
      !Array.isArray(response.items) ||
      response.items.some(
        (p) => !p || typeof p.id !== "string" || typeof p.name !== "string",
      )
    )
      throw new ApiError("INVALID_RESPONSE", "Invalid provider list");
    if (epoch === this.providerEpoch && request > this.providerApplied && !signal?.aborted) {
      this.providerApplied = request;
      this.providerInstances.set(response.items);
    }
    return response.items;
  }
  async page(
    providerId: string,
    cursor: string | null,
    signal?: AbortSignal,
  ): Promise<TrackPage> {
    const query = new URLSearchParams({ limit: "100" });
    if (providerId !== "all") query.set("providerInstanceId", providerId);
    if (cursor) query.set("cursor", cursor);
    const response = await this.client.request<TrackPage>(
      `/source-tracks?${query}`,
      { signal },
    );
    if (
      !response ||
      !Array.isArray(response.items) ||
      !response.items.every(isTrack) ||
      typeof response.libraryRevision !== "string" ||
      (response.nextCursor !== null && typeof response.nextCursor !== "string")
    )
      throw new ApiError("INVALID_RESPONSE", "Invalid track page");
    return response;
  }
}
