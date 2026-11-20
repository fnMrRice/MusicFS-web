import { useRef, useState } from "react";
import { ApiError, errorMessage, withRequestId } from "../../api/client";
import type { MusicTrack } from "../../api/music-catalog";
import { useServices } from "../../app/services";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { TrackMetadataFields } from "./TrackMetadataFields";
import { trackMetadataDraft, toTrackMetadata, validTrackMetadata } from "./track-metadata-draft";

export function unavailableTrackMessage(error: unknown): string | null {
  return error instanceof ApiError && (error.status === 404 || error.status === 409 && error.code === "RESOURCE_CHANGED")
    ? withRequestId("这首曲目已被合并或移除，请在刷新后的列表中重新选择。", error) : null;
}

export function TrackMetadataEditor({ track, applied, refresh, busyChanged }: {
  track: MusicTrack; applied: () => void; refresh: () => void; busyChanged: (busy: boolean) => void;
}) {
  const { musicCatalog } = useServices();
  const [initial] = useState(() => trackMetadataDraft(track));
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [retryKey, setRetryKey] = useState<string>();
  const [recovery, setRecovery] = useState<"track" | "list" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const metadata = toTrackMetadata(draft);
  const dirty = JSON.stringify(metadata) !== JSON.stringify(toTrackMetadata(initial));
  const canSave = !!track.revision && validTrackMetadata(draft) && dirty && !recovery;
  async function save() {
    if (!canSave || lock.current || !track.revision) return;
    const key = retryKey ?? crypto.randomUUID();
    lock.current = true; setSaving(true); busyChanged(true); setError(null);
    try {
      await musicCatalog.updateTrackMetadata(track.trackId, track.revision, metadata, key);
      applied();
    } catch (cause) {
      const uncertain = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
      const unavailable = unavailableTrackMessage(cause);
      setRetryKey(uncertain ? key : undefined);
      setRecovery(unavailable ? "list" : cause instanceof ApiError && (cause.status === 409 || cause.status === 412) ? "track" : null);
      setError(unavailable ?? (uncertain ? withRequestId("保存结果待确认，请重试或关闭后刷新。", cause) : errorMessage(cause)));
    } finally {
      lock.current = false; setSaving(false); busyChanged(false);
    }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    <TrackMetadataFields draft={draft} onChange={setDraft} disabled={saving || !!recovery || !!retryKey} />
    <ErrorNotice error={error} />
    {recovery ? <button type="button" onClick={recovery === "list" ? applied : refresh}>{tr(recovery === "list" ? "刷新列表并重新选择" : "刷新资料")}</button>
      : <button type="submit" className="primary" disabled={saving || !canSave}>{tr(retryKey ? "重试确认保存" : "保存")}</button>}
  </form>;
}
