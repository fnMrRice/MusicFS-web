import { ApiError } from "../api/client";
import { MatchingApi, type MatchingMutation, type MatchingRequest } from "../api/matching";
import { Store } from "../app/store";

export interface PendingDecision { key: string; request: MatchingRequest; status: "pending" | "uncertain" }

function valid(value: unknown): value is PendingDecision {
  if (!value || typeof value !== "object") return false;
  const item = value as PendingDecision;
  if (typeof item.key !== "string" || !item.key || !item.request || !Number.isSafeInteger(item.request.expectedRevision) || item.request.expectedRevision < 0) return false;
  const request = item.request;
  const id = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 256;
  if (request.kind === "links") return Array.isArray(request.sourceTrackIds) && request.sourceTrackIds.length >= 2 &&
    request.sourceTrackIds.length <= 256 && request.sourceTrackIds.every(id) && (request.targetRecordingId === null || id(request.targetRecordingId));
  if (request.kind === "unlinks") return id(request.sourceTrackId);
  return request.kind === "exclusions" && id(request.leftSourceTrackId) && id(request.rightSourceTrackId) && typeof request.excluded === "boolean";
}

// 决策提交由登录会话持有，页面切换不会中断提交或丢失幂等键。
export class MatchingDecisions {
  pending = new Store<PendingDecision[]>([]);
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
    this.active.clear(); this.pending.set([]); this.storageKey = null;
  }
  private update(items: PendingDecision[]): void {
    this.pending.set(items);
    if (this.storageKey) try { sessionStorage.setItem(this.storageKey, JSON.stringify(items)); } catch { /* 当前会话继续保留待确认请求。 */ }
  }
  submit(request: MatchingRequest, key: string): Promise<MatchingMutation> {
    const running = this.active.get(key);
    if (running) return running.promise;
    const previous = this.pending.value.find((item) => item.key === key);
    const pending: PendingDecision = { key, request: previous?.request ?? request, status: "pending" };
    this.update([...this.pending.value.filter((item) => item.key !== key), pending]);
    const controller = new AbortController();
    const generation = this.generation;
    const promise = this.api.mutate(pending.request, key, controller.signal).then((result) => {
      if (generation === this.generation) {
        this.update(this.pending.value.filter((item) => item.key !== key)); this.changed();
      }
      return result;
    }, (error: unknown) => {
      if (generation === this.generation) {
        const final = error instanceof ApiError && [400, 401, 403, 404, 409, 412, 422].includes(error.status);
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
