import { ApiError } from "../api/client";
import { MatchingApi, isBulkMergeMutation, type BulkMergeMutation, type MatchingMutation, type MatchingRequest } from "../api/matching";
import { Store } from "../app/store";

export interface PendingDecision { key: string; request: MatchingRequest; status: "pending" | "uncertain" }

function valid(value: unknown): value is PendingDecision {
  if (!value || typeof value !== "object") return false;
  const item = value as PendingDecision;
  if (typeof item.key !== "string" || !item.key || !item.request || !Number.isSafeInteger(item.request.expectedRevision) || item.request.expectedRevision < 0) return false;
  const request = item.request;
  const id = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 256;
  if (request.kind === "bulk-merge") return request.mode === "title_artist" ? request.minimumScore === undefined :
    request.mode === "score" && Number.isInteger(request.minimumScore) && request.minimumScore! >= 0 && request.minimumScore! <= 100;
  if (request.kind === "links") return Array.isArray(request.sourceTrackIds) && request.sourceTrackIds.length >= 2 &&
    request.sourceTrackIds.length <= 256 && request.sourceTrackIds.every(id) && (request.targetRecordingId === null || id(request.targetRecordingId));
  if (request.kind === "unlinks") return id(request.sourceTrackId);
  if (request.kind === "default-source") return id(request.recordingId) && (request.sourceTrackId === null || id(request.sourceTrackId));
  return request.kind === "exclusions" && id(request.leftSourceTrackId) && id(request.rightSourceTrackId) && typeof request.excluded === "boolean";
}

// 决策提交由登录会话持有，页面切换不会中断提交或丢失幂等键。
export class MatchingDecisions {
  pending = new Store<PendingDecision[]>([]);
  lastBulkMerge = new Store<BulkMergeMutation | null>(null);
  private storageKey: string | null = null;
  private generation = 0;
  private active = new Map<string, { controller: AbortController; promise: Promise<MatchingMutation> }>();
  constructor(private api: MatchingApi, private changed: () => void) {}
  setSession(server: string, user: string): void {
    this.clear();
    this.storageKey = `musicfs:${encodeURIComponent(server)}:${encodeURIComponent(user)}:matching-decisions`;
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(this.storageKey) ?? "[]");
      if (Array.isArray(saved)) this.pending.set(saved.filter(valid).slice(0, 8).map((item) => ({ ...item, status: "uncertain" })));
    } catch { /* 存储不可用时仍可使用当前会话。 */ }
  }
  clear(): void {
    ++this.generation;
    this.active.forEach((entry) => entry.controller.abort());
    this.active.clear(); this.pending.set([]); this.lastBulkMerge.set(null); this.storageKey = null;
  }
  private update(items: PendingDecision[]): void {
    this.pending.set(items);
    if (this.storageKey) try { sessionStorage.setItem(this.storageKey, JSON.stringify(items)); } catch { /* 当前会话继续保留待确认请求。 */ }
  }
  submit(request: MatchingRequest, key: string): Promise<MatchingMutation> {
    const running = this.active.get(key);
    if (running) return running.promise;
    const previous = this.pending.value.find((item) => item.key === key);
    if (!previous && this.pending.value.length > 0)
      return Promise.reject(new ApiError("MATCHING_PENDING", "Confirm the pending matching operation first"));
    const pending: PendingDecision = { key, request: previous?.request ?? request, status: "pending" };
    if (pending.request.kind === "bulk-merge") this.lastBulkMerge.set(null);
    this.update([...this.pending.value.filter((item) => item.key !== key), pending]);
    const controller = new AbortController();
    const generation = this.generation;
    const promise = this.api.mutate(pending.request, key, controller.signal).then((result) => {
      if (generation === this.generation) {
        if (pending.request.kind === "bulk-merge" && isBulkMergeMutation(result)) this.lastBulkMerge.set(result);
        this.update(this.pending.value.filter((item) => item.key !== key)); this.changed();
      }
      return result;
    }, (error: unknown) => {
      if (generation === this.generation) {
        const final = error instanceof ApiError && [400, 401, 403, 404, 409, 410, 412, 422].includes(error.status);
        this.update(final ? this.pending.value.filter((item) => item.key !== key) :
          this.pending.value.map((item) => item.key === key ? { ...item, status: "uncertain" } : item));
        this.changed();
      }
      throw error;
    }).finally(() => { if (generation === this.generation) this.active.delete(key); });
    this.active.set(key, { controller, promise });
    return promise;
  }
}
