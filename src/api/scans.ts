import { ApiClient, ApiError } from "./client";
import { LibraryApi } from "./library";
import { scanMetadataResults } from "./scan-metadata";

export interface ScanRequest {
  mode: "full";
  schemaRevision: string;
  rootIds: string[];
  options: { refreshMetadata?: boolean };
}
export interface ScanJob {
  jobId: string;
  providerInstanceId: string;
  status: "queued" | "running" | "retry_wait" | "succeeded" | "failed" | "cancelled" | "paused";
  progress: { observed: number; total?: number | null };
  complete: boolean;
  error: { code: string; message: string; requestId?: string } | null;
}
export const pendingScanStatuses = ["queued", "running", "retry_wait"];
const statuses = [...pendingScanStatuses, "succeeded", "failed", "cancelled", "paused"];

function validJob(job: ScanJob, instance: string, id?: string): ScanJob {
  if (!job || typeof job.jobId !== "string" || !job.jobId || id !== undefined && job.jobId !== id
    || job.providerInstanceId !== instance || !statuses.includes(job.status)
    || typeof job.complete !== "boolean" || !job.progress || !Number.isInteger(job.progress.observed)
    || job.progress.observed < 0 || (job.progress.total != null && (!Number.isInteger(job.progress.total) || job.progress.total < 0)))
    throw new ApiError("INVALID_RESPONSE", "Invalid scan job");
  return job;
}

export class ScansApi {
  constructor(private client: ApiClient, private library: LibraryApi) {}
  private async source(instance: string, signal?: AbortSignal, rootId?: string) {
    const provider = (await this.library.providers(signal)).find((item) => item.id === instance);
    if (!provider || !["available", "online"].includes(provider.availability))
      throw new ApiError("SOURCE_UNAVAILABLE", "Source is not ready");
    if (!provider.capabilities?.includes("library.scan")) throw new ApiError("UNSUPPORTED", "Source cannot scan music");
    if (!provider.roots?.length) throw new ApiError("SCAN_NO_ROOTS", "No music folders configured");
    if (!provider.configuration?.schemaRevision) throw new ApiError("UNSUPPORTED", "Scan configuration is unavailable");
    if (rootId !== undefined && !provider.roots.some((root) => root.id === rootId))
      throw new ApiError("RESOURCE_CHANGED", "Music folder is no longer available");
    return provider;
  }
  async prepare(instance: string, signal?: AbortSignal, rootId?: string): Promise<ScanRequest> {
    const provider = await this.source(instance, signal, rootId);
    return { mode: "full", schemaRevision: provider.configuration!.schemaRevision,
      rootIds: rootId === undefined ? provider.roots!.map((root) => root.id) : [rootId],
      options: rootId === undefined ? {} : { refreshMetadata: true } };
  }
  async prepareRefresh(instance: string, signal?: AbortSignal, rootId?: string) {
    const provider = await this.source(instance, signal, rootId);
    return provider.roots!.filter(root => rootId === undefined || root.id === rootId).map(root => ({
      name: root.name, request: { mode: "full", schemaRevision: provider.configuration!.schemaRevision,
        rootIds: [root.id], options: { refreshMetadata: true } } as ScanRequest,
    }));
  }
  metadataResults(id: string, signal?: AbortSignal) { return scanMetadataResults(this.client, id, signal); }
  async submit(instance: string, body: ScanRequest, key: string, signal?: AbortSignal) {
    const result = await this.client.request<{ jobId: string; merged: boolean }>(
      `/provider-instances/${encodeURIComponent(instance)}/scan-jobs`,
      { method: "POST", body, idempotencyKey: key, signal },
    );
    if (!result || typeof result.jobId !== "string" || !result.jobId || typeof result.merged !== "boolean")
      throw new ApiError("INVALID_RESPONSE", "Invalid scan submission");
    return result;
  }
  async job(id: string, instance: string, signal?: AbortSignal): Promise<ScanJob> {
    const job = await this.client.request<ScanJob>(`/scan-jobs/${encodeURIComponent(id)}`, { signal });
    return validJob(job, instance, id);
  }
  async status(instance: string, signal?: AbortSignal): Promise<ScanJob | null> {
    const result = await this.client.request<{ job: ScanJob | null }>(
      `/provider-instances/${encodeURIComponent(instance)}/scan-status`, { signal },
    );
    if (!result || typeof result !== "object" || !("job" in result))
      throw new ApiError("INVALID_RESPONSE", "Invalid scan status");
    return result.job === null ? null : validJob(result.job, instance);
  }
}
