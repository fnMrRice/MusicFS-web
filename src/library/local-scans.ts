import type { ScansApi } from "../api/scans";
import { LocalScanState } from "./local-scan-state";

type ScanSessionStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
function browserStorage(): ScanSessionStorage | null {
  try { return sessionStorage; } catch { return null; }
}

/** 扫描属于登录会话，页面切换只移除视图订阅，不中断任务确认。 */
export class LocalScans {
  private states = new Map<string, LocalScanState>();
  private prefix: string | null = null;
  constructor(private api: ScansApi, private finished: (instance: string, succeeded: boolean) => void,
    private storage = browserStorage()) {}

  setSession(server: string, user: string): void {
    const prefix = `musicfs:${encodeURIComponent(server)}:${encodeURIComponent(user)}:scan:`;
    if (this.prefix === prefix) return;
    this.clear();
    this.prefix = prefix;
    // 刷新到音乐库等其他页面时，同样恢复已提交任务的结果确认。
    try {
      const keys = Array.from({ length: this.storage?.length ?? 0 }, (_, index) => this.storage!.key(index));
      for (const key of keys) if (key?.startsWith(prefix)) {
        try { this.get(decodeURIComponent(key.slice(prefix.length))); } catch { /* 忽略损坏的本地记录。 */ }
      }
    } catch { /* 存储不可用时继续使用内存状态。 */ }
  }
  get(instance: string): LocalScanState {
    if (!this.prefix) throw new Error("Scan session is unavailable");
    if (!this.states.has(instance)) {
      const key = `${this.prefix}${encodeURIComponent(instance)}`;
      const storage = this.storage;
      const state = new LocalScanState(this.api, instance, {
        get() { try { return storage?.getItem(key) ?? null; } catch { return null; } },
        set(value) {
          try { if (value) storage?.setItem(key, value); else storage?.removeItem(key); }
          catch { /* 存储不可用时保留内存进度。 */ }
        },
      }, (succeeded) => this.finished(instance, succeeded));
      this.states.set(instance, state);
      state.attach();
    }
    return this.states.get(instance)!;
  }
  invalidate(): void {
    for (const state of this.states.values()) state.invalidate();
  }
  capabilitiesChanged(): void {
    for (const state of this.states.values()) if (state.value.automaticQueued) state.invalidate();
  }
  clear(): void {
    this.states.forEach((state) => state.detach());
    this.states.clear();
    this.prefix = null;
  }
}
