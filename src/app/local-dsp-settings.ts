import { Store } from "./store";
import { defaultLocalDSP, normalizeLocalDSP, type LocalDSPConfig } from "../player/dsp/model";

export interface LocalDSPSettingsState {
  config: LocalDSPConfig;
  supported: boolean;
  error: string | null;
  storageError: string | null;
}

export class LocalDSPSettingsStore extends Store<LocalDSPSettingsState> {
  private storageKey: string | null = null;

  constructor(supported: boolean) {
    super({ config: defaultLocalDSP(), supported, error: null, storageError: null });
  }

  setSession(instanceId: string, userId: string): void {
    const key = `musicfs:local-dsp:v1:${encodeURIComponent(instanceId)}:${encodeURIComponent(userId)}`;
    if (key === this.storageKey) return;
    this.storageKey = key;
    let config = defaultLocalDSP();
    let storageError: string | null = null;
    try {
      const saved = localStorage.getItem(key);
      if (saved) config = normalizeLocalDSP(JSON.parse(saved));
    } catch {
      storageError = "无法读取本地音效设置，已使用默认值。";
    }
    this.set({ ...this.value, config, error: null, storageError });
  }

  clear(): void {
    this.storageKey = null;
    this.set({ ...this.value, config: defaultLocalDSP(), error: null, storageError: null });
  }

  update(value: LocalDSPConfig): void {
    const config = normalizeLocalDSP(value);
    let storageError: string | null = null;
    if (this.storageKey) {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(config));
      } catch {
        storageError = "本地存储不可用，当前设置仅在本次页面内保留，刷新后可能丢失。";
      }
    }
    this.set({ ...this.value, config, storageError });
  }

  reportError(message: string | null): void {
    if (this.value.error !== message) this.set({ ...this.value, error: message });
  }
}
