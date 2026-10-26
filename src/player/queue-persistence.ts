import type { SourceTrack } from "../api/types";
import { PlaybackQueue, type PlaybackQueueSnapshot } from "./playback-queue";

const storageKey = "musicfs:playback-queue:v1";
const modes = ["sequence", "repeat-one", "repeat-all", "shuffle"];
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === "string" ? value : null;
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function trackMetadata(value: unknown): SourceTrack | null {
  if (!record(value) || typeof value.sourceTrackId !== "string" || !value.sourceTrackId ||
    typeof value.providerInstanceId !== "string" || !value.providerInstanceId ||
    typeof value.displayName !== "string" || value.availability !== "available") return null;
  // 只保留播放和展示所需元数据，不缓存版本树、未知字段及播放会话。
  return {
    sourceTrackId: value.sourceTrackId, providerInstanceId: value.providerInstanceId,
    displayName: value.displayName, availability: value.availability,
    title: text(value.title), artists: Array.isArray(value.artists) ? value.artists.filter((artist) => typeof artist === "string") : null,
    durationMs: number(value.durationMs), codec: text(value.codec), container: text(value.container),
    bitrateBps: number(value.bitrateBps), sampleRateHz: number(value.sampleRateHz),
    assetId: text(value.assetId), recordingId: text(value.recordingId), coverObjectId: text(value.coverObjectId),
    album: text(value.album), genre: text(value.genre),
  };
}

function readSnapshot(value: unknown): PlaybackQueueSnapshot | null {
  if (!record(value) || !Array.isArray(value.items) || typeof value.mode !== "string" || !modes.includes(value.mode)) return null;
  const items = value.items.map(trackMetadata);
  if (items.some((item) => item === null)) return null;
  const validIndex = (index: unknown): index is number =>
    typeof index === "number" && Number.isInteger(index) && index >= 0 && index < items.length;
  const indices = (entries: unknown): number[] => Array.isArray(entries) ? entries.filter(validIndex) : [];
  return {
    items: items as SourceTrack[], index: validIndex(value.index) ? value.index : -1,
    mode: value.mode as PlaybackQueueSnapshot["mode"],
    history: indices(value.history), future: indices(value.future), priority: indices(value.priority),
  };
}

export class QueuePersistence {
  private serverAddress: string | null = null;

  constructor(private queue: PlaybackQueue) {
    queue.subscribe(() => this.save());
  }

  setServer(serverAddress: string): void {
    if (serverAddress === this.serverAddress) {
      this.queue.restore(this.queue.snapshot());
      return;
    }
    this.serverAddress = null;
    this.queue.clear();
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      const snapshot = record(saved) && saved.serverAddress === serverAddress ? readSnapshot(saved.queue) : null;
      if (snapshot) this.queue.restore(snapshot);
      else localStorage.removeItem(storageKey);
    } catch {
      // 存储不可用或缓存损坏时仍允许使用内存队列。
    }
    this.serverAddress = serverAddress;
  }

  detach(): void { this.serverAddress = null; }

  clear(): void {
    this.detach();
    try { localStorage.removeItem(storageKey); } catch { /* 存储不可用时仍清空内存。 */ }
    this.queue.clear();
  }

  private save(): void {
    if (!this.serverAddress) return;
    try {
      const snapshot = this.queue.snapshot();
      localStorage.setItem(storageKey, JSON.stringify({
        serverAddress: this.serverAddress,
        queue: { ...snapshot, items: snapshot.items.map(trackMetadata) },
      }));
    } catch {
      // 写入失败不阻断播放和队列操作。
    }
  }
}
