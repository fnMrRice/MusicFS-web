import { ApiError } from "../api/client";
import { ScansApi, pendingScanStatuses, type ScanJob, type ScanRequest } from "../api/scans";
import { Store } from "../app/store";
import { scanError } from "./scan-errors";

interface PendingScan { request: ScanRequest; key: string; jobId: string | null }
interface SavedScan { pending: PendingScan | null; automatic: boolean }
export interface ScanStorage { get(): string | null; set(value: string | null): void }
export interface LocalScanSnapshot { busy: boolean; pending: boolean; automaticQueued: boolean; job: ScanJob | null; error: string | null }

function restore(storage: ScanStorage): SavedScan {
  try {
    const record = JSON.parse(storage.get() ?? "null") as (SavedScan & PendingScan) | null;
    const saved = record && "pending" in record ? record.pending : record;
    const automatic = record?.automatic === true;
    if (!saved) return { pending: null, automatic };
    if (saved && typeof saved.key === "string" && saved.key && (saved.jobId === null || typeof saved.jobId === "string")
      && saved.request?.mode === "full" && typeof saved.request.schemaRevision === "string"
      && Array.isArray(saved.request.rootIds) && saved.request.rootIds.length > 0
      && saved.request.rootIds.every((id) => typeof id === "string")
      && saved.request.options && Object.keys(saved.request.options).length === 0) return { pending: saved, automatic };
  } catch { /* 损坏或不可用的存储不影响新的扫描。 */ }
  return { pending: null, automatic: false };
}

export class LocalScanState extends Store<LocalScanSnapshot> {
  private pending: PendingScan | null;
  private automatic: boolean;
  private automaticRevision = 0;
  private readinessAttempts = 0;
  private mounted = false;
  private generation = 0;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private api: ScansApi, private instance: string, private storage: ScanStorage,
    private finished: (succeeded: boolean) => void) {
    const saved = restore(storage);
    super({ busy: false, pending: saved.pending !== null || saved.automatic, automaticQueued: saved.automatic, job: null, error: null });
    this.pending = saved.pending;
    this.automatic = saved.automatic;
  }
  private patch(patch: Partial<LocalScanSnapshot>) { this.set({ ...this.value, ...patch }); }
  private persist(pending: PendingScan | null = this.pending) {
    this.pending = pending;
    this.storage.set(pending || this.automatic ? JSON.stringify({ pending, automatic: this.automatic }) : null);
    this.patch({ pending: pending !== null || this.automatic, automaticQueued: this.automatic });
  }
  attach(): () => void {
    this.mounted = true;
    if (this.value.pending) void this.resume();
    return () => this.detach();
  }
  detach(): void {
    this.mounted = false;
    ++this.generation;
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.patch({ busy: false });
  }
  async start(): Promise<void> {
    if (this.value.busy || this.value.pending) return;
    await this.run(true);
  }
  requestAutomatic(): void {
    this.automatic = true;
    ++this.automaticRevision;
    this.readinessAttempts = 0;
    this.persist();
    if (!this.value.busy && (!this.pending || this.value.error)) void this.resume();
  }
  async resume(): Promise<void> {
    if (this.value.busy || !this.value.pending) return;
    await this.run(!this.pending);
  }
  private async run(fresh: boolean): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const current = () => generation === this.generation && !controller.signal.aborted;
    const automaticRevision = this.automaticRevision;
    let waitForReady = false;
    let continueAutomatic = false;
    this.patch({ busy: true, error: null, ...(fresh ? { job: null } : {}) });
    let stage: "prepare" | "submit" | "poll" = fresh ? "prepare" : this.pending?.jobId ? "poll" : "submit";
    try {
      if (fresh) {
        const request = await this.api.prepare(this.instance, controller.signal);
        if (!current()) return;
        if (automaticRevision === this.automaticRevision) this.automatic = false;
        this.readinessAttempts = 0;
        // 在提交前持久化请求和幂等键，刷新或网络中断后可确认同一次提交。
        this.persist({ request, key: crypto.randomUUID(), jobId: null });
      }
      if (!this.pending) return;
      if (!this.pending.jobId) {
        stage = "submit";
        const accepted = await this.api.submit(this.instance, this.pending.request, this.pending.key, controller.signal);
        if (!current()) return;
        this.persist({ ...this.pending, jobId: accepted.jobId });
      }
      stage = "poll";
      const job = await this.api.job(this.pending!.jobId!, this.instance, controller.signal);
      if (!current()) return;
      this.patch({ job });
      if (!pendingScanStatuses.includes(job.status)) {
        this.persist(null);
        continueAutomatic = this.automatic;
        const succeeded = job.status === "succeeded" && job.complete;
        const messages = {
          failed: "扫描失败；请检查音乐目录和插件状态后重新扫描。",
          cancelled: "扫描已取消，可重新发起扫描。",
          paused: "扫描已暂停；请处理来源或权限问题后重新扫描。",
          succeeded: "扫描未完整完成；保留上次成功扫描的内容，请重新扫描。",
        };
        if (!succeeded) this.patch({ error: messages[job.status as keyof typeof messages] });
        this.finished(succeeded);
      }
    } catch (error) {
      if (!current()) return;
      const uncertain = !(error instanceof ApiError) || error.status >= 500
        || ["TIMEOUT", "NETWORK_ERROR", "INVALID_RESPONSE", "CANCELLED"].includes(error.code);
      if (stage === "submit" && !uncertain) this.persist(null);
      const missing = stage === "poll" && error instanceof ApiError && error.status === 404;
      if (missing) this.persist(null);
      continueAutomatic = this.automatic && !this.pending && stage !== "prepare";
      waitForReady = stage === "prepare" && this.automatic && error instanceof ApiError
        && ["SOURCE_UNAVAILABLE", "SOURCE_OFFLINE"].includes(error.code) && ++this.readinessAttempts < 30;
      this.patch({ error: missing ? "扫描记录已不可用，请检查音乐库后重新扫描。" : scanError(error) });
    } finally {
      if (current()) {
        this.patch({ busy: false });
        if (this.mounted && (this.pending && !this.value.error || continueAutomatic || waitForReady))
          this.timer = setTimeout(() => void this.resume(), 1000);
      }
    }
  }
}
