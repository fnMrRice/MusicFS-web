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
  readonly downloadChanges = new Store<ReadonlyMap<string, number>>(new Map());
  private providerEpoch = 0;
  private providerRequest = 0;
  private providerApplied = 0;
  private lastProviderRead = 0;
  constructor(private client: ApiClient) {}
  async track(sourceTrackId: string, signal?: AbortSignal): Promise<SourceTrack> {
    const response = await this.client.request<SourceTrack>(`/source-tracks/${encodeURIComponent(sourceTrackId)}`, { signal });
    if (!isTrack(response) || response.sourceTrackId !== sourceTrackId)
      throw new ApiError("INVALID_RESPONSE", "Invalid source track response");
    return response;
  }
  async deleteDownload(sourceTrackId: string, versionId: string): Promise<void> {
    const session = this.providerEpoch;
    try {
      await this.client.request<void>(`/source-tracks/${encodeURIComponent(sourceTrackId)}/downloads/${encodeURIComponent(versionId)}`, { method: "DELETE" });
    } catch (error) {
      // 定时清理或另一页面可能已删除同一版本，重新读取该来源即可确认现状。
      if (!(error instanceof ApiError) || error.code !== "NOT_FOUND") throw error;
    }
    if (session === this.providerEpoch) {
      const changes = new Map(this.downloadChanges.value);
      changes.set(sourceTrackId, (changes.get(sourceTrackId) ?? 0) + 1);
      this.downloadChanges.set(changes);
    }
  }
  clearProviderInstances(): void {
    ++this.providerEpoch;
    this.providerInstances.set([]);
    this.downloadChanges.set(new Map());
  }
  async providers(signal?: AbortSignal): Promise<Provider[]> {
    this.lastProviderRead = Date.now();
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
  recheckUnavailableNetworkProviders(): void {
    if (Date.now() - this.lastProviderRead < 30_000) return;
    if (this.providerInstances.value.some(p => p.sourceType === "network" && ["offline", "unavailable"].includes(p.availability))) {
      void this.providers().catch(() => { /* 保留上次确认的实例状态。 */ });
    }
  }
  async page(
    providerId: string,
    cursor: string | null,
    signal?: AbortSignal,
    grouped = false,
  ): Promise<TrackPage> {
    const query = new URLSearchParams({ limit: "100" });
    if (grouped) query.set("groupBy", "recording");
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
      (grouped && response.matchingRevision !== undefined && (
        !Number.isSafeInteger(response.matchingRevision) || response.matchingRevision < 0 ||
        response.items.some((track) => !Array.isArray(track.versions) || !track.versions.length ||
          !track.versions.every(isTrack) || !track.versions.some((version) => version.sourceTrackId === track.sourceTrackId) ||
          new Set(track.versions.map((version) => version.sourceTrackId)).size !== track.versions.length)
      )) ||
      typeof response.libraryRevision !== "string" ||
      (response.nextCursor !== null && typeof response.nextCursor !== "string")
    )
      throw new ApiError("INVALID_RESPONSE", "Invalid track page");
    return response;
  }
}
