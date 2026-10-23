import type { ScansApi, ScanRequest } from "../api/scans";
import { ApiError } from "../api/client";
import { Store } from "../app/store";
import { refreshError } from "./refresh-errors";

export interface PendingRefresh {
  provider: string;
  name: string;
  request: ScanRequest;
  key: string;
  sending: boolean;
  error: string | null;
  rejected: boolean;
  uncertain: boolean;
}
interface SubmissionSnapshot {
  pending: PendingRefresh[];
  preparing: string[];
  notices: Record<string, { submitted: number; merged: number }>;
  errors: Record<string, { message: string; root?: string }>;
}
type SubmissionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const initial = (): SubmissionSnapshot => ({ pending: [], preparing: [], notices: {}, errors: {} });
function browserStorage(): SubmissionStorage | null { try { return localStorage; } catch { return null; } }
const identity = (provider: string, root?: string) => JSON.stringify([provider, root ?? null]);

/** 只保存尚未确认的提交；已受理任务的进度与取消结果始终从服务端恢复。 */
export class RefreshSubmission extends Store<SubmissionSnapshot> {
  private storageKey: string | null = null;
  private generation = 0;
  private controllers = new Set<AbortController>();
  constructor(private api: ScansApi, private accepted: (provider: string, jobId: string) => void,
    private storage = browserStorage()) { super(initial()); }
  setSession(server: string, user: string): void {
    const key = `musicfs:${encodeURIComponent(server)}:${encodeURIComponent(user)}:refresh-submissions`;
    if (key === this.storageKey) return;
    this.clear(); this.storageKey = key;
    try {
      const saved: unknown = JSON.parse(this.storage?.getItem(key) ?? "[]");
      if (!Array.isArray(saved)) return;
      const seen = new Set<string>();
      const pending = saved.filter((item): item is PendingRefresh => {
        if (!item || typeof item.provider !== "string" || !item.provider || typeof item.name !== "string"
          || typeof item.key !== "string" || !item.key || item.request?.mode !== "full"
          || typeof item.request.schemaRevision !== "string" || !item.request.schemaRevision
          || !Array.isArray(item.request.rootIds) || item.request.rootIds.length !== 1
          || typeof item.request.rootIds[0] !== "string" || !item.request.rootIds[0]
          || item.request.options?.refreshMetadata !== true) return false;
        const id = identity(item.provider, item.request.rootIds[0]);
        if (seen.has(id)) return false;
        seen.add(id); return true;
      }).map(item => ({ ...item, uncertain: item.uncertain === true || item.sending === true,
        rejected: item.rejected === true && !item.uncertain && !item.sending, sending: false,
        error: item.rejected === true && !item.uncertain && !item.sending ? item.error : "上次提交尚未确认，请继续确认。" }));
      this.set({ ...initial(), pending });
    } catch { /* 损坏的提交记录不影响查看服务端任务。 */ }
  }
  clear(): void {
    ++this.generation; this.controllers.forEach(controller => controller.abort()); this.controllers.clear();
    this.storageKey = null; this.set(initial());
  }
  isPreparing(provider: string): boolean { return this.value.preparing.includes(provider); }
  isPending(provider: string, root: string): boolean {
    return this.value.pending.some(item => item.provider === provider && item.request.rootIds[0] === root);
  }
  private persist(pending: PendingRefresh[]): void {
    if (this.storageKey) try {
      if (pending.length) this.storage?.setItem(this.storageKey, JSON.stringify(pending));
      else this.storage?.removeItem(this.storageKey);
    } catch { /* 存储不可用时仍保留当前页面中的原请求与幂等键。 */ }
    this.set({ ...this.value, pending });
  }
  async start(provider: string, root?: string): Promise<void> {
    if (!this.storageKey || this.isPreparing(provider)) return;
    if (root === undefined && this.value.pending.some(item => item.provider === provider)) return;
    if (root !== undefined && this.isPending(provider, root)) return;
    const generation = this.generation, id = provider, controller = new AbortController();
    this.controllers.add(controller);
    this.set({ ...this.value, preparing: [...this.value.preparing, id], notices: { ...this.value.notices, [provider]: { submitted: 0, merged: 0 } },
      errors: { ...this.value.errors, [provider]: { message: "", root } } });
    let keys: string[] = [];
    try {
      const prepared = await this.api.prepareRefresh(provider, controller.signal, root);
      if (generation !== this.generation) return;
      // 一次冻结全部目录与配置，之后每根独立确认，不重新读取或重发已成功的目录。
      const additions = prepared.filter(item => !this.isPending(provider, item.request.rootIds[0]))
        .map(item => ({ provider, ...item, key: crypto.randomUUID(), sending: false, error: null, rejected: false, uncertain: false }));
      keys = additions.map(item => item.key);
      this.persist([...this.value.pending, ...additions]);
    } catch (error) {
      if (generation === this.generation) this.set({ ...this.value, errors: { ...this.value.errors, [provider]: { message: refreshError(error), root } } });
    } finally {
      this.controllers.delete(controller);
      if (generation === this.generation) this.set({ ...this.value, preparing: this.value.preparing.filter(item => item !== id) });
    }
    if (generation !== this.generation) return;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, keys.length) }, async () => {
      while (next < keys.length && generation === this.generation) await this.retry(keys[next++]);
    }));
  }
  async retry(key: string): Promise<void> {
    let pending = this.value.pending.find(item => item.key === key);
    if (!this.storageKey || !pending || pending.sending) return;
    if (pending.rejected && this.isPreparing(pending.provider)) return;
    const generation = this.generation, controller = new AbortController(); this.controllers.add(controller);
    let submitted = false;
    this.persist(this.value.pending.map(item => item.key === key ? { ...item, sending: true, error: null } : item));
    try {
      if (pending.rejected) {
        this.set({ ...this.value, preparing: [...this.value.preparing, pending.provider] });
        try {
          const [prepared] = await this.api.prepareRefresh(pending.provider, controller.signal, pending.request.rootIds[0]);
          if (generation !== this.generation) return;
          pending = { ...pending, ...prepared, key: crypto.randomUUID(), rejected: false, uncertain: false, sending: true, error: null };
          this.persist(this.value.pending.map(item => item.key === key ? pending! : item));
          key = pending.key;
        } finally {
          if (generation === this.generation) this.set({ ...this.value, preparing: this.value.preparing.filter(item => item !== pending!.provider) });
        }
      }
      submitted = true;
      const result = await this.api.submit(pending.provider, pending.request, key, controller.signal);
      if (generation !== this.generation) return;
      this.persist(this.value.pending.filter(item => item.key !== key));
      const notice = this.value.notices[pending.provider] ?? { submitted: 0, merged: 0 };
      this.set({ ...this.value, notices: { ...this.value.notices, [pending.provider]: {
        submitted: notice.submitted + (result.merged ? 0 : 1), merged: notice.merged + (result.merged ? 1 : 0),
      } } });
      this.accepted(pending.provider, result.jobId);
    } catch (error) {
      // 明确被拒绝的请求可以读取新配置后重提；网络中断、超时及未知结果只能确认原请求。
      const definitive = error instanceof ApiError && [400, 404, 409, 422].includes(error.status)
        && ["INVALID_ARGUMENT", "CONFLICT", "NOT_FOUND", "RESOURCE_CHANGED", "REVISION_CONFLICT", "UNSUPPORTED"].includes(error.code);
      const uncertain = pending.uncertain || submitted && !definitive;
      const rejected = !uncertain && (pending.rejected || definitive);
      if (generation === this.generation) this.persist(this.value.pending.map(item => item.key === key
        ? { ...item, sending: false, rejected, uncertain,
          error: uncertain && definitive ? "提交结果仍无法确认，请先查看任务队列。" : refreshError(error) } : item));
    } finally { this.controllers.delete(controller); }
  }
  dismiss(key: string): void {
    this.persist(this.value.pending.filter(item => item.key !== key || !item.rejected || item.sending));
  }
}
