import type { RefreshTask } from "../../src/api/tasks";

export function refreshTask(overrides: Partial<RefreshTask> = {}): RefreshTask {
  return { id: "task-1", kind: "metadataRefresh", ownerId: "user", ownerName: "Alice", providerInstanceId: "local",
    providerName: "本地音乐", rootIds: ["music"], roots: [{ id: "music", name: "Music" }], status: "queued", phase: "queued",
    cancelRequested: false, cancellable: true, progress: { observed: 0, metadataTotal: 0, metadataCompleted: 0 },
    result: { updated: 0, retained: 0, notFound: 0, failed: 0 }, createdAt: "2026-10-23T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z",
    error: null, ...overrides };
}
