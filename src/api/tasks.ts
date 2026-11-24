import { ApiClient, ApiError } from "./client";
import type { BulkMergeMode } from "./matching";

export type TaskScope = "mine" | "all";
interface TaskBase {
  id: string;
  ownerId: string;
  ownerName: string;
  status: "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
  cancelRequested: boolean;
  cancellable: boolean;
  createdAt: string;
  updatedAt: string;
  error: { code: string; message: string; requestId?: string } | null;
}
interface UpdateCounts { updated: number; retained: number; notFound: number; failed: number }
interface BatchProgress { completed: number; total: number }
export interface RefreshTask extends TaskBase {
  kind: "metadataRefresh";
  phase: "queued" | "scanning" | "metadata" | "finished";
  providerInstanceId: string;
  providerName: string;
  rootIds: string[];
  roots: { id: string; name: string }[];
  progress: { observed: number; metadataTotal: number; metadataCompleted: number };
  result: UpdateCounts;
}
interface AlbumScrapeTask extends TaskBase {
  kind: "albumAutoScrape";
  phase: "queued" | "scraping" | "finished";
  progress: BatchProgress;
  result: UpdateCounts;
}
interface BulkMergeTask extends TaskBase {
  kind: "bulkMerge";
  phase: "queued" | "merging" | "finished";
  progress: BatchProgress;
  result: { mergedGroups: number; mergedSources: number; skippedGroups: number };
}
export type Task = RefreshTask | AlbumScrapeTask | BulkMergeTask;
export type CatalogTaskRequest =
  | { kind: "albumAutoScrape"; providerInstanceId?: string; q?: string }
  | { kind: "bulkMerge"; mode: BulkMergeMode; minimumScore?: number; expectedRevision: number };
export interface TaskPage { items: Task[]; nextCursor: string | null; activeCount: number }
export interface TaskSnapshot { page: TaskPage; changed: Task[]; reset: boolean }
export const taskActive = (task: Task) => ["queued", "running", "cancelling"].includes(task.status);
const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;
function validDetails(task: Task): boolean {
  if (!task.progress || !task.result) return false;
  if (task.kind === "metadataRefresh") {
    return ["queued", "scanning", "metadata", "finished"].includes(task.phase)
      && typeof task.providerInstanceId === "string" && typeof task.providerName === "string"
      && Array.isArray(task.rootIds) && Array.isArray(task.roots) && task.roots.length > 0 && task.rootIds.length === task.roots.length
      && task.roots.every((root, index) => root && typeof root.name === "string" && typeof root.id === "string" && root.id === task.rootIds[index])
      && [task.progress.observed, task.progress.metadataTotal, task.progress.metadataCompleted,
        task.result.updated, task.result.retained, task.result.notFound, task.result.failed].every(count);
  }
  if (![task.progress.total, task.progress.completed].every(count)) return false;
  if (task.kind === "albumAutoScrape") return ["queued", "scraping", "finished"].includes(task.phase)
    && [task.result.updated, task.result.retained, task.result.notFound, task.result.failed].every(count);
  return task.kind === "bulkMerge" && ["queued", "merging", "finished"].includes(task.phase)
    && [task.result.mergedGroups, task.result.mergedSources, task.result.skippedGroups].every(count);
}
function validTask(task: Task, id?: string): Task {
  if (!task || typeof task.id !== "string" || !task.id || id !== undefined && task.id !== id
    || !["queued", "running", "cancelling", "succeeded", "failed", "cancelled"].includes(task.status)
    || [task.ownerId, task.ownerName, task.createdAt, task.updatedAt].some(value => typeof value !== "string")
    || typeof task.cancellable !== "boolean" || typeof task.cancelRequested !== "boolean"
    || !validDetails(task)
    || task.error !== null && (!task.error || typeof task.error.code !== "string" || typeof task.error.message !== "string"))
    throw new ApiError("INVALID_RESPONSE", "Invalid task");
  return task;
}
export class TasksApi {
  constructor(private client: ApiClient) {}
  async enqueue(request: CatalogTaskRequest, key: string): Promise<Task> {
    const { kind, ...body } = request;
    const path = kind === "albumAutoScrape" ? "/tasks/album-scrape" : "/tasks/bulk-merge";
    const task = validTask(await this.client.request<Task>(path, { method: "POST", body, idempotencyKey: key }));
    if (task.kind !== kind) throw new ApiError("INVALID_RESPONSE", "Unexpected submitted task kind");
    return task;
  }
  subscribe(subscriptionId: string, scope: TaskScope, signal: AbortSignal): Promise<void> {
    return this.client.control("/tasks/subscription", { method: "POST", body: { subscriptionId, scope }, signal });
  }
  async list(scope: TaskScope, cursor: string | null = null, signal?: AbortSignal): Promise<TaskPage> {
    const query = new URLSearchParams({ scope, limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const page = await this.client.request<TaskPage>(`/tasks?${query}`, { signal });
    return validPage(page);
  }
  async get(id: string, scope: TaskScope, signal?: AbortSignal): Promise<Task> {
    return validTask(await this.client.request<Task>(`/tasks/${encodeURIComponent(id)}?scope=${scope}`, { signal }), id);
  }
  async cancel(id: string, scope: TaskScope, signal?: AbortSignal): Promise<Task> {
    return validTask(await this.client.request<Task>(`/tasks/${encodeURIComponent(id)}/cancel?scope=${scope}`,
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
