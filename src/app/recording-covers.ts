import type { SourceTrack } from "../api/types";
import { catalogArtworkPath, onlineArtworkPath } from "../api/artwork";
import { Store } from "./store";

type CoverMetadata = Pick<SourceTrack, "recordingId" | "coverObjectId" | "onlineCoverPath" | "catalogCoverPath">;

/** 按旧对象暂存显示元数据；新曲库对象直接使用服务端值，避免冻结自动选图。 */
export class RecordingCovers extends Store<WeakMap<SourceTrack, CoverMetadata>> {
  constructor() { super(new WeakMap()); }
  update(recordingId: string, objectId: string | null, tracks: SourceTrack[], sourceTrackIds: string[] = []): void {
    const next = this.retained(tracks);
    for (const track of tracks) {
      const currentRecording = this.value.has(track) ? this.value.get(track)!.recordingId : track.recordingId;
      if (currentRecording === recordingId || sourceTrackIds.includes(track.sourceTrackId)) {
        const old = this.value.get(track) ?? track;
        next.set(track, { recordingId, coverObjectId: objectId, onlineCoverPath: old.onlineCoverPath });
      }
    }
    this.set(next);
  }
  reconcile(items: SourceTrack[], tracks: SourceTrack[]): void {
    const current = new Map<string, SourceTrack>();
    for (const item of items) {
      current.set(item.sourceTrackId, item);
      for (const version of item.versions ?? []) current.set(version.sourceTrackId, item);
    }
    const next = this.retained(tracks);
    for (const track of tracks) {
      const fresh = current.get(track.sourceTrackId);
      if (fresh) next.set(track, { recordingId: fresh.recordingId, coverObjectId: fresh.coverObjectId,
        onlineCoverPath: fresh.onlineCoverPath, catalogCoverPath: fresh.catalogCoverPath });
    }
    this.set(next);
  }
  private retained(tracks: SourceTrack[]): WeakMap<SourceTrack, CoverMetadata> {
    const next = new WeakMap<SourceTrack, CoverMetadata>();
    for (const track of tracks) if (this.value.has(track)) next.set(track, this.value.get(track)!);
    return next;
  }
  clear(): void { this.set(new WeakMap()); }
}

export function trackCover(track: SourceTrack | null, covers: RecordingCovers["value"]): string | null | undefined {
  if (!track) return;
  const cover = covers.get(track) ?? track;
  const local = cover.coverObjectId ? catalogArtworkPath(`/api/v1/media/${encodeURIComponent(cover.coverObjectId)}`) : undefined;
  return catalogArtworkPath(cover.catalogCoverPath) ?? local ?? onlineArtworkPath(cover.onlineCoverPath) ??
    (cover.coverObjectId === null ? null : undefined);
}
