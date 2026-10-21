import { ApiClient, ApiError } from "../api/client";
import { DirectoriesApi, type PluginOperation } from "../api/directories";

interface WaitingConfiguration {
  instance: string; operationId: string; controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
}
type SessionStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
function browserStorage(): SessionStorage | null {
  try { return sessionStorage; } catch { return null; }
}

/** 配置操作应用成功后再扫描；等待过程不依赖目录弹窗的生命周期。 */
export class ConfigurationScans {
  private prefix: string | null = null;
  private waiting = new Map<string, WaitingConfiguration>();
  private observed = new Set<string>();
  constructor(private client: ApiClient, private scan: (instance: string) => void,
    private storage = browserStorage()) {}

  setSession(server: string, user: string): void {
    const prefix = `musicfs:${encodeURIComponent(server)}:${encodeURIComponent(user)}:scan-configuration:`;
    if (prefix === this.prefix) return;
    this.clear();
    this.prefix = prefix;
    try {
      const keys = Array.from({ length: this.storage?.length ?? 0 }, (_, index) => this.storage!.key(index));
      for (const key of keys) if (key?.startsWith(prefix)) {
        try {
          const saved = JSON.parse(this.storage!.getItem(key)!);
          if (typeof saved.instance === "string" && typeof saved.operationId === "string")
            this.watch(saved.instance, { operationId: saved.operationId, status: "applying", errorCode: null });
        } catch { /* 忽略损坏的待扫描记录。 */ }
      }
    } catch { /* 存储不可用时使用内存状态。 */ }
  }
  watch(instance: string, operation: PluginOperation): void {
    if (!this.prefix || this.observed.has(operation.operationId)) return;
    this.observed.add(operation.operationId);
    const waiting: WaitingConfiguration = { instance, operationId: operation.operationId, controller: new AbortController(), timer: null };
    this.waiting.set(operation.operationId, waiting);
    try { this.storage?.setItem(this.prefix + encodeURIComponent(operation.operationId), JSON.stringify({ instance, operationId: operation.operationId })); }
    catch { /* 存储不可用时保留内存进度。 */ }
    this.accept(waiting, operation);
  }
  private accept(waiting: WaitingConfiguration, operation: PluginOperation): void {
    if (waiting.controller.signal.aborted) return;
    if (operation.status === "applying" || operation.status === "draining") {
      waiting.timer = setTimeout(() => void this.poll(waiting), 1000);
      return;
    }
    if (operation.status === "succeeded") this.scan(waiting.instance);
    this.forget(waiting);
  }
  private async poll(waiting: WaitingConfiguration): Promise<void> {
    try {
      const operation = await new DirectoriesApi(this.client, waiting.instance).operation(waiting.operationId, waiting.controller.signal);
      if (operation.operationId !== waiting.operationId || !["applying", "draining", "succeeded", "failed", "superseded"].includes(operation.status))
        throw new ApiError("INVALID_RESPONSE", "Invalid directory operation");
      this.accept(waiting, operation);
    } catch (error) {
      if (waiting.controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 404) this.forget(waiting);
      else waiting.timer = setTimeout(() => void this.poll(waiting), 2000);
    }
  }
  private forget(waiting: WaitingConfiguration): void {
    this.waiting.delete(waiting.operationId);
    try { this.storage?.removeItem(this.prefix + encodeURIComponent(waiting.operationId)); }
    catch { /* 已完成状态仍在当前会话中去重。 */ }
  }
  clear(): void {
    for (const waiting of this.waiting.values()) {
      waiting.controller.abort();
      if (waiting.timer) clearTimeout(waiting.timer);
    }
    this.waiting.clear();
    this.observed.clear();
    this.prefix = null;
  }
}
