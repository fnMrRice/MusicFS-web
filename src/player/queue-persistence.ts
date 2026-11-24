import type { SourceTrack } from "../api/types";
import { catalogArtworkPath, onlineArtworkPath } from "../api/artwork";
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
  const selection = value.playbackSelection;
  const playbackSelection = record(selection) && typeof selection.trackId === "string" && selection.trackId &&
    (selection.forcedSourceTrackId === null || typeof selection.forcedSourceTrackId === "string" && selection.forcedSourceTrackId)
    ? { trackId: selection.trackId, forcedSourceTrackId: selection.forcedSourceTrackId } : undefined;
  // 只保留播放和展示所需元数据，不缓存版本树、未知字段及播放会话。
  return {
    sourceTrackId: value.sourceTrackId, providerInstanceId: value.providerInstanceId,
    displayName: value.displayName, availability: value.availability,
    title: text(value.title), artists: Array.isArray(value.artists) ? value.artists.filter((artist) => typeof artist === "string") : null,
    durationMs: number(value.durationMs), codec: text(value.codec), container: text(value.container),
    bitrateBps: number(value.bitrateBps), sampleRateHz: number(value.sampleRateHz),
    assetId: text(value.assetId), recordingId: text(value.recordingId), coverObjectId: text(value.coverObjectId),
    onlineCoverPath: onlineArtworkPath(value.onlineCoverPath), catalogCoverPath: catalogArtworkPath(text(value.catalogCoverPath)),
    album: text(value.album), genre: text(value.genre), playbackSelection,
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
  private userId: string | null = null;

  constructor(private queue: PlaybackQueue) {
    queue.subscribe(() => this.save());
  }

  setServer(serverAddress: string, userId: string): void {
    if (serverAddress === this.serverAddress && userId === this.userId) {
      this.queue.restore(this.queue.snapshot());
      return;
    }
    this.detach();
    this.queue.clear();
    this.serverAddress = serverAddress;
    this.userId = userId;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      const snapshot = record(saved) && saved.serverAddress === serverAddress &&
        saved.userId === userId ? readSnapshot(saved.queue) : null;
      if (snapshot) this.queue.restore(snapshot);
      else localStorage.removeItem(storageKey);
    } catch {
      // 存储不可用或缓存损坏时仍允许使用内存队列。
    }
  }

  detach(): void { this.serverAddress = null; this.userId = null; }

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
        userId: this.userId,
        queue: { ...snapshot, items: snapshot.items.map(trackMetadata) },
      }));
    } catch {
      // 写入失败不阻断播放和队列操作。
    }
  }
}
