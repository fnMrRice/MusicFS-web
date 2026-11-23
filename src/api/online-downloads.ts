import { ApiClient, ApiError } from "./client";
import type { PluginField } from "./plugin-settings";
import type { DownloadVersion } from "./types";

export interface DownloadOptions {
  defaultQuality: string;
  options: NonNullable<PluginField["options"]>;
}
export interface DownloadRequest {
  externalIds: string[];
  quality: string;
  accountId: string;
  accountRevision?: string;
}
export interface DownloadJobItem {
  externalId: string;
  state: "queued" | "running" | "succeeded" | "failed";
  version?: DownloadVersion;
  error?: { code: string; message: string; retryAfter?: number };
}
export interface DownloadSummary {
  jobId: string;
  state: "queued" | "running" | "succeeded" | "partial" | "failed";
  total: number;
  completed: number;
  failed: number;
}
export interface DownloadJob extends DownloadSummary {
  items: DownloadJobItem[];
}

export async function getDownloadOptions(client: ApiClient, instanceId: string, signal?: AbortSignal): Promise<DownloadOptions> {
  const result = await client.request<DownloadOptions>(
    `/online-instances/${encodeURIComponent(instanceId)}/download-qualities`, { signal });
  if (!result || typeof result.defaultQuality !== "string" || !Array.isArray(result.options) ||
      !result.options.length || result.options.length > 32 || result.options.some(o => !o || typeof o.value !== "string" ||
        typeof o.label !== "string" || !o.label || (o.localizedLabels !== undefined &&
          (!o.localizedLabels || typeof o.localizedLabels !== "object" || Array.isArray(o.localizedLabels) ||
            Object.values(o.localizedLabels).some(s => typeof s !== "string")))) ||
      !result.options.some(o => o.value === result.defaultQuality) ||
      new Set(result.options.map(o => o.value)).size !== result.options.length) {
    throw new ApiError("INVALID_RESPONSE", "Invalid online download qualities");
  }
  return result;
}

function validItem(item: DownloadJobItem) {
  if (!item || typeof item.externalId !== "string" || !item.externalId) return false;
  if (item.state === "succeeded") {
    const v = item.version;
    return item.error === undefined && v && typeof v.versionId === "string" && !!v.versionId && typeof v.quality === "string" &&
      typeof v.mime === "string" && typeof v.container === "string" && typeof v.codec === "string" &&
      Number.isSafeInteger(v.sizeBytes) && v.sizeBytes > 0 && typeof v.downloadedAt === "string";
  }
  if (item.state === "failed") return item.version === undefined && item.error &&
    typeof item.error.code === "string" && typeof item.error.message === "string";
  return (item.state === "queued" || item.state === "running") && item.version === undefined && item.error === undefined;
}

function checkSummary(job: DownloadSummary) {
  if (!job || typeof job.jobId !== "string" || !job.jobId || !["queued", "running", "succeeded", "partial", "failed"].includes(job.state) ||
      !Number.isInteger(job.total) || job.total < 1 || job.total > 10_000 ||
      !Number.isInteger(job.completed) || job.completed < 0 || !Number.isInteger(job.failed) || job.failed < 0 ||
      job.completed + job.failed > job.total) {
    throw new ApiError("INVALID_RESPONSE", "Invalid online download progress");
  }
  return job;
}

function checkJob(job: DownloadJob) {
  checkSummary(job);
  if (!Array.isArray(job.items) || job.total !== job.items.length || job.items.some(item => !validItem(item)) ||
      job.items.filter(item => item.state === "succeeded").length !== job.completed ||
      job.items.filter(item => item.state === "failed").length !== job.failed) {
    throw new ApiError("INVALID_RESPONSE", "Invalid online download job");
  }
  return job;
}

export async function createDownloadJob(client: ApiClient, instanceId: string, input: DownloadRequest, idempotencyKey: string, signal?: AbortSignal) {
  const job = checkJob(await client.request<DownloadJob>(
    `/online-instances/${encodeURIComponent(instanceId)}/download-jobs`, { method: "POST", body: input, idempotencyKey, signal }));
  const ids = [...new Set(input.externalIds)];
  if (ids.length !== job.total || job.items.some((item, index) => item.externalId !== ids[index])) {
    throw new ApiError("INVALID_RESPONSE", "Download job does not match the requested tracks");
  }
  return job;
}

export async function getDownloadJob(client: ApiClient, jobId: string, signal?: AbortSignal) {
  const job = checkJob(await client.request<DownloadJob>(`/online-download-jobs/${encodeURIComponent(jobId)}`, { signal }));
  if (job.jobId !== jobId) throw new ApiError("INVALID_RESPONSE", "Download job identity changed");
  return job;
}

export async function getDownloadSummary(client: ApiClient, jobId: string, signal?: AbortSignal) {
  const job = checkSummary(await client.request<DownloadSummary>(
    `/online-download-jobs/${encodeURIComponent(jobId)}?view=summary`, { signal }));
  if (job.jobId !== jobId) throw new ApiError("INVALID_RESPONSE", "Download job identity changed");
  return job;
}
