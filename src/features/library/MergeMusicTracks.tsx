import { useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { musicTrack, type MusicTrack } from "../../api/music-catalog";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";

export function MergeMusicTracks({ albumId, albumRevision, matchingRevision, tracks, close, applied }: {
  albumId: string; albumRevision: number; matchingRevision: number; tracks: MusicTrack[];
  close: () => void; applied: () => void;
}) {
  const services = useServices();
  const sourced = tracks.filter(track => track.selectedSource);
  const [target, setTarget] = useState((sourced[0] ?? tracks[0])?.trackId ?? "");
  const [busy, setBusy] = useState(false);
  const [retryKey, setRetryKey] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const unavailable = tracks.some(track => !track.revision) || tracks.length > 64;
  async function save() {
    if (lock.current || !target || conflict || unavailable) return;
    lock.current = true; setBusy(true); setError(null);
    const key = retryKey ?? crypto.randomUUID();
    try {
      const result = await services.client.request<unknown>(`/library/albums/${encodeURIComponent(albumId)}/merge-tracks`, {
        method: "POST", idempotencyKey: key, body: { targetTrackId: target, expectedMatchingRevision: matchingRevision,
          expectedAlbumRevision: albumRevision, tracks: tracks.map(track => ({ trackId: track.trackId, expectedRevision: track.revision })) },
      });
      if (!musicTrack(result) || !result.trackId || (sourced.length < 2 && result.trackId !== target)) {
        throw new ApiError("INVALID_RESPONSE", "Invalid merged track");
      }
      applied();
    } catch (cause) {
      const uncertain = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
      setRetryKey(uncertain ? key : undefined);
      setConflict(cause instanceof ApiError && cause.status === 409);
      setError(cause instanceof ApiError && cause.code === "ALBUM_TRACK_SLOT_CONFLICT" ? tr("所选歌曲在另一张专辑中占用不同曲序，请先核对那张专辑。")
        : uncertain ? tr("保存结果待确认，请重试或关闭后刷新。") : errorMessage(cause));
    } finally { lock.current = false; setBusy(false); }
  }
  return <Modal title={tr("合并歌曲")} close={() => { if (!lock.current) close(); }}>
    <p>{tr("选择要保留的曲目。其他曲名将成为别名，歌单和专辑引用将转到这首曲目。")}</p>
    <fieldset disabled={busy || conflict || !!retryKey}><legend>{tr("保留的曲目")}</legend>
      {tracks.map(track => <label className="check-label" key={track.trackId}>
        <input type="radio" name="merge-primary-track" checked={target === track.trackId}
          onChange={() => setTarget(track.trackId)} />
        {track.title} · {track.selectedSource ? tr("{0} 个来源版本", {0: track.selectedSource.versions?.length ?? 1}) : tr("暂无来源")}
      </label>)}
    </fieldset>
    {unavailable && <p role="status">{tr("请刷新专辑后重新选择，单次最多合并 64 首。")}</p>}
    <ErrorNotice error={error} />
    <div className="list-actions">
      {conflict ? <button onClick={applied}>{tr("刷新列表并重新选择")}</button>
        : <button className="primary" disabled={busy || unavailable} onClick={() => void save()}>
          {tr(retryKey ? "重试确认保存" : "确认合并")}</button>}
      <button disabled={busy} onClick={close}>{tr("取消")}</button>
    </div>
  </Modal>;
}
