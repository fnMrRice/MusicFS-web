import { useRef, useState } from "react";
import { ApiError, errorMessage, withRequestId } from "../../api/client";
import type { MusicTrack } from "../../api/music-catalog";
import { useServices } from "../../app/services";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { TrackMetadataFields } from "./TrackMetadataFields";
import { trackMetadataDraft, toTrackMetadata, validTrackMetadata } from "./track-metadata-draft";

export function TrackMetadataEditor({ track, applied, refresh, busyChanged }: {
  track: MusicTrack; applied: () => void; refresh: () => void; busyChanged: (busy: boolean) => void;
}) {
  const { musicCatalog } = useServices();
  const [initial] = useState(() => trackMetadataDraft(track));
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [retryKey, setRetryKey] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const metadata = toTrackMetadata(draft);
  const dirty = JSON.stringify(metadata) !== JSON.stringify(toTrackMetadata(initial));
  const canSave = !!track.revision && validTrackMetadata(draft) && dirty && !conflict;
  async function save() {
    if (!canSave || lock.current || !track.revision) return;
    const key = retryKey ?? crypto.randomUUID();
    lock.current = true; setSaving(true); busyChanged(true); setError(null);
    try {
      await musicCatalog.updateTrackMetadata(track.trackId, track.revision, metadata, key);
      applied();
    } catch (cause) {
      const uncertain = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
      setRetryKey(uncertain ? key : undefined);
      setConflict(cause instanceof ApiError && (cause.status === 409 || cause.status === 412));
      setError(uncertain ? withRequestId("保存结果待确认，请重试或关闭后刷新。", cause) : errorMessage(cause));
    } finally {
      lock.current = false; setSaving(false); busyChanged(false);
    }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    <TrackMetadataFields draft={draft} onChange={setDraft} disabled={saving || conflict || !!retryKey} />
    <ErrorNotice error={error} />
    {conflict ? <button type="button" onClick={refresh}>{tr("刷新资料")}</button>
      : <button type="submit" className="primary" disabled={saving || !canSave}>{tr(retryKey ? "重试确认保存" : "保存")}</button>}
  </form>;
}
