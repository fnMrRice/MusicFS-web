import { ApiClient, ApiError } from "./client";

export type TaskScope = "mine" | "all";
export interface RefreshTask {
  id: string;
  kind: "metadataRefresh";
  ownerId: string;
  ownerName: string;
  providerInstanceId: string;
  providerName: string;
  rootIds: string[];
  roots: { id: string; name: string }[];
  status: "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
  phase: "queued" | "scanning" | "metadata" | "finished";
  cancelRequested: boolean;
  cancellable: boolean;
  progress: { observed: number; metadataTotal: number; metadataCompleted: number };
  result: { updated: number; retained: number; notFound: number; failed: number };
  createdAt: string;
  updatedAt: string;
  error: { code: string; message: string; requestId?: string } | null;
}
export interface TaskPage { items: RefreshTask[]; nextCursor: string | null; activeCount: number }
export interface TaskSnapshot { page: TaskPage; changed: RefreshTask[]; reset: boolean }
export const taskActive = (task: RefreshTask) => ["queued", "running", "cancelling"].includes(task.status);
const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;
function validTask(task: RefreshTask, id?: string): RefreshTask {
  if (!task || typeof task.id !== "string" || !task.id || id !== undefined && task.id !== id
    || task.kind !== "metadataRefresh" || !["queued", "running", "cancelling", "succeeded", "failed", "cancelled"].includes(task.status)
    || !["queued", "scanning", "metadata", "finished"].includes(task.phase)
    || [task.ownerId, task.ownerName, task.providerInstanceId, task.providerName, task.createdAt, task.updatedAt].some(value => typeof value !== "string")
    || !Array.isArray(task.rootIds) || !Array.isArray(task.roots) || task.rootIds.length !== task.roots.length
    || !task.roots.length || task.roots.some((root, index) => !root || typeof root.name !== "string" || typeof root.id !== "string" || root.id !== task.rootIds[index])
    || typeof task.cancellable !== "boolean" || typeof task.cancelRequested !== "boolean"
    || !task.progress || ![task.progress.observed, task.progress.metadataTotal, task.progress.metadataCompleted].every(count)
    || !task.result || ![task.result.updated, task.result.retained, task.result.notFound, task.result.failed].every(count)
    || task.error !== null && (!task.error || typeof task.error.code !== "string" || typeof task.error.message !== "string"))
    throw new ApiError("INVALID_RESPONSE", "Invalid refresh task");
  return task;
}
export class TasksApi {
  constructor(private client: ApiClient) {}
  subscribe(subscriptionId: string, scope: TaskScope, signal: AbortSignal): Promise<void> {
    return this.client.control("/tasks/subscription", { method: "POST", body: { subscriptionId, scope }, signal });
  }
  async list(scope: TaskScope, cursor: string | null = null, signal?: AbortSignal): Promise<TaskPage> {
    const query = new URLSearchParams({ scope, limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const page = await this.client.request<TaskPage>(`/tasks?${query}`, { signal });
    return validPage(page);
  }
  async get(id: string, scope: TaskScope, signal?: AbortSignal): Promise<RefreshTask> {
    return validTask(await this.client.request<RefreshTask>(`/tasks/${encodeURIComponent(id)}?scope=${scope}`, { signal }), id);
  }
  async cancel(id: string, scope: TaskScope, signal?: AbortSignal): Promise<RefreshTask> {
    return validTask(await this.client.request<RefreshTask>(`/tasks/${encodeURIComponent(id)}/cancel?scope=${scope}`,
      { method: "POST", body: {}, signal }), id);
  }
}

function validPage(page: TaskPage): TaskPage {
  if (!page || !Array.isArray(page.items) || !count(page.activeCount)
    || page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor))
    throw new ApiError("INVALID_RESPONSE", "Invalid task page");
  return { ...page, items: page.items.map(task => validTask(task)) };
}

export function taskSnapshot(data: unknown, subscriptionId: string): TaskSnapshot | null {
  if (!data || typeof data !== "object" || !("subscriptionId" in data) || data.subscriptionId !== subscriptionId) return null;
  const snapshot = data as TaskSnapshot & { subscriptionId: string };
  if (!Array.isArray(snapshot.changed) || typeof snapshot.reset !== "boolean")
    throw new ApiError("INVALID_RESPONSE", "Invalid task snapshot");
  return { page: validPage(snapshot.page), changed: snapshot.changed.map(task => validTask(task)), reset: snapshot.reset };
}
