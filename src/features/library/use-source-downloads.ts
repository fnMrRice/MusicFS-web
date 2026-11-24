import { useSyncExternalStore } from "react";
import type { SourceTrack } from "../../api/types";
import { useServices } from "../../app/services";

export function useSourceDownloads(track: SourceTrack) {
  const { libraryApi } = useServices();
  const id = track.sourceTrackId;
  const changed = useSyncExternalStore(libraryApi.downloadChanges.subscribe, () => libraryApi.downloadChanges.value.get(id));
  const original = track.downloadVersions ?? [];
  // 仅覆盖仍含旧下载的快照；重新下载同一版本后，以新的下载时间和文件资料为准。
  const removed = (v: typeof original[number]) => changed?.removed.some(old =>
    old.versionId === v.versionId && old.downloadedAt === v.downloadedAt);
  if (!changed || !original.some(removed)) return { versions: original, downloaded: track.downloaded, pending: false };
  const versions = changed.versions ?? original.filter(v => !removed(v));
  return { versions, downloaded: !!versions.length, pending: !changed.versions && !changed.error,
    error: changed.error, retry: () => void libraryApi.refreshDownloads(id) };
}
