import { ApiError } from "../api/client";
import { ScansApi, pendingScanStatuses, type ScanJob, type ScanRequest } from "../api/scans";
import { Store } from "../app/store";
import { scanError } from "./scan-errors";
import type { ScanMetadataSummary } from "../api/scan-metadata";

interface PendingScan { request: ScanRequest; key: string; jobId: string | null }
interface SavedScan { pending: PendingScan | null; automatic: boolean }
export interface ScanStorage { get(): string | null; set(value: string | null): void }
export interface LocalScanSnapshot {
  busy: boolean; checking: boolean; pending: boolean; automaticQueued: boolean; job: ScanJob | null; error: string | null;
  refreshing: boolean; metadata: ScanMetadataSummary | null;
}

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
      && saved.request.options && Object.entries(saved.request.options).every(([key, value]) => key === "refreshMetadata" && value === true))
      return { pending: saved, automatic };
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
  private discovery: Promise<void> | null = null;
  private finishedJob: string | null = null;
  constructor(private api: ScansApi, private instance: string, private storage: ScanStorage,
    private finished: (succeeded: boolean) => void) {
    const saved = restore(storage);
    super({ busy: false, checking: true, pending: saved.pending !== null || saved.automatic, automaticQueued: saved.automatic, job: null, error: null,
      refreshing: saved.pending?.request.options.refreshMetadata === true, metadata: null });
    this.pending = saved.pending;
    this.automatic = saved.automatic;
  }
  private patch(patch: Partial<LocalScanSnapshot>) { this.set({ ...this.value, ...patch }); }
  private active(): boolean { return !!this.value.job && pendingScanStatuses.includes(this.value.job.status); }
  private persist(pending: PendingScan | null = this.pending) {
    this.pending = pending;
    this.storage.set(pending || this.automatic ? JSON.stringify({ pending, automatic: this.automatic }) : null);
    this.patch({ pending: pending !== null || this.automatic || this.active(), automaticQueued: this.automatic });
  }
  attach(): () => void {
    this.mounted = true;
    if (this.value.pending) void this.resume();
    else void this.refreshStatus();
    return () => this.detach();
  }
  detach(): void {
    this.mounted = false;
    ++this.generation;
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.patch({ busy: false, checking: false });
  }
  async start(): Promise<void> {
    const generation = this.generation;
    if (this.discovery) await this.discovery;
    if (generation !== this.generation) return;
    if (this.value.busy || this.value.pending) return;
    await this.run(true);
  }
  async refresh(rootId: string): Promise<void> {
    const generation = this.generation;
    if (this.discovery) await this.discovery;
    if (generation !== this.generation) return;
    if (this.value.busy || this.value.pending) return;
    await this.run(true, rootId);
  }
  requestAutomatic(): void {
    this.automatic = true;
    ++this.automaticRevision;
    this.readinessAttempts = 0;
    this.persist();
    if (!this.value.busy && (!this.pending || this.value.error)) void this.resume();
  }
  async resume(): Promise<void> {
    const generation = this.generation;
    if (this.discovery) await this.discovery;
    if (generation !== this.generation) return;
    if (this.value.busy || !this.value.pending) return;
    if (!this.pending && this.active()) return this.refreshStatus();
    await this.run(!this.pending);
  }
  /** 状态发现只读；未知提交必须由恢复流程使用原请求和幂等键确认。 */
  async refreshStatus(): Promise<void> {
    if (this.discovery) return this.discovery;
    if (this.value.busy) return;
    if (this.pending) {
      if (this.pending.jobId) await this.run(false);
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const current = () => generation === this.generation && !controller.signal.aborted;
    const previous = this.active() ? this.value.job : null;
    const discovery = (async () => {
      try {
        const job = await this.api.status(this.instance, controller.signal);
        if (!current()) return;
        // 新任务可能已排队；先确认此前跟踪的任务，避免遗漏它的发布结果。
        if (previous && job?.jobId !== previous.jobId) {
          try {
            const tracked = await this.api.job(previous.jobId, this.instance, controller.signal);
            if (!current()) return;
            if (!pendingScanStatuses.includes(tracked.status)) this.accept(tracked);
          } catch (error) {
            if (!current()) return;
            if (!(error instanceof ApiError) || error.status !== 404) throw error;
          }
        }
        if (job) this.accept(job);
        else { this.patch({ job: null, error: null, refreshing: false, metadata: null }); this.persist(); }
      } catch (error) {
        if (current()) this.patch({ error: scanError(error) });
      } finally {
        if (current()) this.patch({ checking: false });
      }
    })();
    this.discovery = discovery;
    try { await discovery; }
    finally {
      if (this.discovery === discovery) this.discovery = null;
      if (current() && this.mounted) {
        if (this.automatic && !this.active()) void this.resume();
        else this.timer = setTimeout(() => void this.refreshStatus(), 1000);
      }
    }
  }
  private accept(job: ScanJob): void {
    const changed = this.value.job?.jobId !== job.jobId;
    this.patch({ job, error: null, ...(changed ? { refreshing: false, metadata: null } : {}) });
    if (pendingScanStatuses.includes(job.status)) { this.persist(); return; }
    this.persist(null);
    const succeeded = job.status === "succeeded" && job.complete;
    const messages = {
      failed: "扫描失败；请检查音乐目录和插件状态后重新扫描。",
      cancelled: "扫描已取消，可重新发起扫描。",
      paused: "扫描已暂停；请处理来源或权限问题后重新扫描。",
      succeeded: "扫描未完整完成；保留上次成功扫描的内容，请重新扫描。",
    };
    if (!succeeded) this.patch({ error: messages[job.status as keyof typeof messages] });
    else if (this.value.refreshing && this.value.metadata?.failed)
      this.patch({ error: "部分曲目的元数据刷新失败，请检查插件状态后重试。" });
    if (this.finishedJob !== job.jobId) { this.finishedJob = job.jobId; this.finished(succeeded); }
  }
  private async run(fresh: boolean, rootId?: string): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const current = () => generation === this.generation && !controller.signal.aborted;
    const automaticRevision = this.automaticRevision;
    let waitForReady = false;
    let continueAutomatic = false;
    this.patch({ busy: true, checking: false, error: null, ...(fresh ? { job: null, metadata: null, refreshing: rootId !== undefined } : {}) });
    let stage: "prepare" | "submit" | "poll" = fresh ? "prepare" : this.pending?.jobId ? "poll" : "submit";
    try {
      if (fresh) {
        const request = rootId === undefined ? await this.api.prepare(this.instance, controller.signal)
          : await this.api.prepare(this.instance, controller.signal, rootId);
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
        const succeeded = job.status === "succeeded" && job.complete;
        if (succeeded && this.pending?.request.options.refreshMetadata) {
          const metadata = await this.api.metadataResults(job.jobId, controller.signal);
          if (!current()) return;
          this.patch({ metadata });
          if (metadata.pending) return;
        }
        this.accept(job);
        continueAutomatic = this.automatic;
      }
    } catch (error) {
      if (!current()) return;
      const uncertain = !(error instanceof ApiError) || error.status >= 500
        || ["TIMEOUT", "NETWORK_ERROR", "INVALID_RESPONSE", "CANCELLED"].includes(error.code);
      if (stage === "submit" && !uncertain) this.persist(null);
      const missing = stage === "poll" && error instanceof ApiError && error.status === 404;
      if (missing) { this.patch({ job: null }); this.persist(null); }
      continueAutomatic = this.automatic && !this.pending && stage !== "prepare";
      waitForReady = stage === "prepare" && this.automatic && error instanceof ApiError
        && ["SOURCE_UNAVAILABLE", "SOURCE_OFFLINE"].includes(error.code) && ++this.readinessAttempts < 30;
      this.patch({ error: missing ? "扫描记录已不可用，请检查音乐库后重新扫描。" : scanError(error) });
    } finally {
      if (current()) {
        this.patch({ busy: false });
        if (this.mounted && (this.pending && !this.value.error || continueAutomatic || waitForReady))
          this.timer = setTimeout(() => void this.resume(), 1000);
        else if (this.mounted && !this.pending && !this.automatic)
          this.timer = setTimeout(() => void this.refreshStatus(), 1000);
      }
    }
  }
}
