import { Store } from "./store";
import { defaultAudioOutput, normalizeAudioOutput, type AudioOutputConfig, type AudioOutputStatus } from "../player/dsp/output";

export interface AudioOutputSettingsState {
  config: AudioOutputConfig;
  status: AudioOutputStatus;
  storageError: string | null;
  dirty: boolean;
  saved: boolean;
}

export class AudioOutputSettingsStore extends Store<AudioOutputSettingsState> {
  private storageKey: string | null = null;
  private savedConfig = defaultAudioOutput();

  constructor(supported: boolean) {
    super({ config: defaultAudioOutput(), status: { supported, maxChannels: null, sourceChannels: null, outputChannels: null, limited: false },
      storageError: null, dirty: false, saved: false });
  }

  setSession(serverAddress: string, userId: string): void {
    const key = `musicfs:audio-output:v1:${encodeURIComponent(serverAddress)}:${encodeURIComponent(userId)}`;
    if (key === this.storageKey) {
      if (this.value.saved) this.set({ ...this.value, saved: false });
      return;
    }
    this.storageKey = key;
    let config = defaultAudioOutput();
    let storageError: string | null = null;
    try {
      const saved = localStorage.getItem(key);
      if (saved) config = normalizeAudioOutput(JSON.parse(saved));
    } catch {
      storageError = "无法读取输出设置，已使用默认值。";
    }
    this.savedConfig = normalizeAudioOutput(config);
    this.set({ ...this.value, config, storageError, dirty: false, saved: false });
  }

  clear(): void {
    this.storageKey = null;
    this.savedConfig = defaultAudioOutput();
    this.set({ ...this.value, config: defaultAudioOutput(), storageError: null, dirty: false, saved: false });
  }

  update(value: AudioOutputConfig): void {
    const config = normalizeAudioOutput(value);
    const dirty = JSON.stringify(config) !== JSON.stringify(this.savedConfig);
    this.set({ ...this.value, config, dirty, saved: false });
  }

  save(): boolean {
    const config = normalizeAudioOutput(this.value.config);
    try {
      if (!this.storageKey) throw new Error("No active audio output settings session");
      localStorage.setItem(this.storageKey, JSON.stringify(config));
    } catch {
      this.set({ ...this.value, saved: false,
        storageError: "本地存储不可用，当前设置仅在本次页面内保留，刷新后可能丢失。" });
      return false;
    }
    this.savedConfig = config;
    this.set({ ...this.value, dirty: false, saved: true, storageError: null });
    return true;
  }

  revert(): void {
    this.set({ ...this.value, config: normalizeAudioOutput(this.savedConfig), dirty: false, saved: false });
  }

  reportStatus(status: AudioOutputStatus): void {
    // 设备状态变化不覆盖用户偏好，也不把草稿标为已保存。
    if (JSON.stringify(status) !== JSON.stringify(this.value.status)) this.set({ ...this.value, status });
  }
}
