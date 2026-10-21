import { ApiClient, ApiError } from "./client";
import { LibraryApi } from "./library";

export interface ScanRequest {
  mode: "full";
  schemaRevision: string;
  rootIds: string[];
  options: Record<string, never>;
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

export class ScansApi {
  constructor(private client: ApiClient, private library: LibraryApi) {}
  async prepare(instance: string, signal?: AbortSignal): Promise<ScanRequest> {
    const provider = (await this.library.providers(signal)).find((item) => item.id === instance);
    if (!provider || !["available", "online"].includes(provider.availability))
      throw new ApiError("SOURCE_UNAVAILABLE", "Source is not ready");
    if (!provider.capabilities?.includes("library.scan")) throw new ApiError("UNSUPPORTED", "Source cannot scan music");
    if (!provider.roots?.length) throw new ApiError("SCAN_NO_ROOTS", "No music folders configured");
    if (!provider.configuration?.schemaRevision) throw new ApiError("UNSUPPORTED", "Scan configuration is unavailable");
    return { mode: "full", schemaRevision: provider.configuration.schemaRevision,
      rootIds: provider.roots.map((root) => root.id), options: {} };
  }
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
    if (!job || job.jobId !== id || job.providerInstanceId !== instance || !statuses.includes(job.status)
      || typeof job.complete !== "boolean" || !job.progress || !Number.isInteger(job.progress.observed)
      || job.progress.observed < 0 || (job.progress.total != null && (!Number.isInteger(job.progress.total) || job.progress.total < 0)))
      throw new ApiError("INVALID_RESPONSE", "Invalid scan job");
    return job;
  }
}
