import { ApiClient, ApiError } from "./client";

interface MetadataResult {
  triggerId: string;
  scanJobId: string;
  reason: string;
  state: string;
  failureCode: string | null;
  actions: { field: string; status: string; reason: string }[];
}
export interface ScanMetadataSummary {
  total: number;
  completed: number;
  applied: number;
  skipped: number;
  failed: number;
  pending: boolean;
}
const states = ["queued", "preparing", "running", "completed", "skipped", "failed"];
const activeStates = ["queued", "preparing", "running"];

/** 扫描成功后仍需等待全部分页中的封面和歌词任务完成。 */
export async function scanMetadataResults(client: ApiClient, id: string, signal?: AbortSignal): Promise<ScanMetadataSummary> {
  const summary: ScanMetadataSummary = { total: 0, completed: 0, applied: 0, skipped: 0, failed: 0, pending: false };
  const cursors = new Set<string>();
  const triggers = new Set<string>();
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: "200" });
    if (cursor) query.set("cursor", cursor);
    const page: { items: MetadataResult[]; nextCursor: string | null } = await client.request(
      `/scan-jobs/${encodeURIComponent(id)}/metadata-results?${query}`, { signal });
    if (!page || !Array.isArray(page.items) || !(page.nextCursor === null || typeof page.nextCursor === "string" && page.nextCursor))
      throw new ApiError("INVALID_RESPONSE", "Invalid scan metadata page");
    for (const item of page.items) {
      if (!item || item.scanJobId !== id || typeof item.triggerId !== "string" || !item.triggerId
        || triggers.has(item.triggerId) || !states.includes(item.state) || typeof item.reason !== "string"
        || !(item.failureCode === null || typeof item.failureCode === "string") || !Array.isArray(item.actions)
        || item.actions.some((action) => !action || !["lyrics", "artwork"].includes(action.field)
          || !["pending", "applied", "skipped", "failed"].includes(action.status) || typeof action.reason !== "string"))
        throw new ApiError("INVALID_RESPONSE", "Invalid scan metadata result");
      triggers.add(item.triggerId);
      if (item.reason !== "refreshMetadata") continue;
      ++summary.total;
      // 失败或跳过的任务可能保留中断前的动作，终态不能被这些动作拖住。
      const pending = activeStates.includes(item.state)
        || item.state === "completed" && item.actions.some((action) => action.status === "pending");
      summary.pending ||= pending;
      if (!pending) ++summary.completed;
      if (item.state === "failed" || item.failureCode || item.actions.some((action) => action.status === "failed")) ++summary.failed;
      summary.applied += item.actions.filter((action) => action.status === "applied").length;
      summary.skipped += item.actions.filter((action) => action.status === "skipped").length;
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new ApiError("INVALID_RESPONSE", "Repeated scan metadata cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return summary;
}
