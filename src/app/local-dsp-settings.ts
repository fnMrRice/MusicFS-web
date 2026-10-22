import { Store } from "./store";
import { defaultLocalDSP, normalizeLocalDSP, type LocalDSPConfig } from "../player/dsp/model";

export interface LocalDSPSettingsState {
  config: LocalDSPConfig;
  supported: boolean;
  error: string | null;
  storageError: string | null;
  dirty: boolean;
  saved: boolean;
}

export class LocalDSPSettingsStore extends Store<LocalDSPSettingsState> {
  private storageKey: string | null = null;
  private savedConfig = defaultLocalDSP();

  constructor(supported: boolean) {
    super({ config: defaultLocalDSP(), supported, error: null, storageError: null, dirty: false, saved: false });
  }

  setSession(instanceId: string, userId: string): void {
    const key = `musicfs:local-dsp:v1:${encodeURIComponent(instanceId)}:${encodeURIComponent(userId)}`;
    if (key === this.storageKey) {
      if (this.value.saved) this.set({ ...this.value, saved: false });
      return;
    }
    this.storageKey = key;
    let config = defaultLocalDSP();
    let storageError: string | null = null;
    try {
      const saved = localStorage.getItem(key);
      if (saved) config = normalizeLocalDSP(JSON.parse(saved));
    } catch {
      storageError = "无法读取本地音效设置，已使用默认值。";
    }
    this.savedConfig = normalizeLocalDSP(config);
    this.set({ ...this.value, config, error: null, storageError, dirty: false, saved: false });
  }

  clear(): void {
    this.storageKey = null;
    this.savedConfig = defaultLocalDSP();
    this.set({ ...this.value, config: defaultLocalDSP(), error: null, storageError: null, dirty: false, saved: false });
  }

  update(value: LocalDSPConfig): void {
    const config = normalizeLocalDSP(value);
    const dirty = JSON.stringify(config) !== JSON.stringify(this.savedConfig);
    this.set({ ...this.value, config, dirty, saved: false });
  }

  save(): boolean {
    const config = normalizeLocalDSP(this.value.config);
    try {
      if (!this.storageKey) throw new Error("No active DSP settings session");
      localStorage.setItem(this.storageKey, JSON.stringify(config));
    } catch {
      this.set({ ...this.value, saved: false,
        storageError: "本地存储不可用，当前设置仅在本次页面内保留，刷新后可能丢失。" });
      return false;
    }
    // 保存基线使用独立副本，之后的即时预览不会改变撤销目标。
    this.savedConfig = config;
    this.set({ ...this.value, dirty: false, saved: true, storageError: null });
    return true;
  }

  revert(): void {
    this.set({ ...this.value, config: normalizeLocalDSP(this.savedConfig), dirty: false, saved: false, storageError: null });
  }

  reportError(message: string | null): void {
    if (this.value.error !== message) this.set({ ...this.value, error: message });
  }
}
