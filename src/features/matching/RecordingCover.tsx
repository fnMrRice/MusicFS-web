import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { RecordingCoverApi, type RecordingCover as CoverSelection } from "../../api/recording-cover";
import type { SourceTrack } from "../../api/types";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { Cover, Empty, ErrorNotice } from "../../components/ui";
import { useSourceName } from "../../components/use-source-name";
import { tr, useLocale } from "../../i18n";
import "./recording-cover.css";

export function RecordingCover({ recordingId, tracks, close, changed }: {
  recordingId: string; tracks: SourceTrack[]; close: () => void; changed: (result: CoverSelection) => void;
}) {
  useLocale();
  const services = useServices();
  const api = useMemo(() => new RecordingCoverApi(services.client), [services]);
  const sourceName = useSourceName();
  const current = useResource(`recording-cover:${recordingId}`, (signal) => api.get(recordingId, signal));
  const [selected, setSelected] = useState<string | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const pending = useRef<{ revision: number; objectId: string | null; key: string } | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (current.data) setSelected(current.data.manualObjectId); }, [current.data]);
  const data = current.data;
  const staleManual = !!data?.manualObjectId && !data.candidates.some((item) => item.objectId === data.manualObjectId);
  const canSave = !!data && selected !== undefined && !busy && !conflict && !current.loading &&
    (retryable || selected !== data.manualObjectId) && (selected === null || data.candidates.some((item) => item.objectId === selected));
  async function save() {
    if (!canSave || running.current || !data || selected === undefined) return;
    pending.current ??= { revision: data.revision, objectId: selected, key: crypto.randomUUID() };
    const request = pending.current;
    const session = services.auth.value.session;
    running.current = true; setBusy(true); setError(null);
    try {
      const result = await api.select(recordingId, request.revision, request.objectId, request.key);
      pending.current = null;
      if (services.auth.value.session === session) changed(result);
      if (mounted.current) { setRetryable(false); close(); }
    } catch (cause) {
      if (!mounted.current) return;
      const stale = cause instanceof ApiError && (cause.status === 409 || cause.status === 412 ||
        ["CONFLICT", "REVISION_CONFLICT", "RESOURCE_CHANGED"].includes(cause.code));
      const uncertain = cause instanceof ApiError && (cause.status >= 500 || ["TIMEOUT", "NETWORK_ERROR", "INVALID_RESPONSE"].includes(cause.code));
      setConflict(stale); setRetryable(!stale && uncertain);
      if (!uncertain) pending.current = null;
      setError(stale ? "封面或来源版本已发生变化，请刷新封面后重新选择。" : errorMessage(cause));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function reload() {
    pending.current = null; setSelected(undefined); setError(null); setConflict(false); setRetryable(false); current.reload();
  }
  return <Modal title={tr("选择封面")} close={() => { if (!running.current) close(); }}>
    <p className="muted">{tr("从合并歌曲的来源封面中选择；自动模式使用分辨率最高的可用封面。")}</p>
    <ErrorNotice error={current.error} retry={current.reload} />
    <ErrorNotice error={error} />
    {current.loading && <p className="loading" role="status">{tr("正在读取封面…")}</p>}
    {data && <fieldset className="recording-cover-options" disabled={busy || retryable || conflict || current.loading}>
      <legend className="sr-only">{tr("封面选项")}</legend>
      <label className="recording-cover-automatic"><input type="radio" name="recording-cover" checked={selected === null}
        onChange={() => setSelected(null)} />{tr("自动选择最高分辨率")}</label>
      {staleManual && <p className="notice">{tr("原手动封面已不可用，当前使用自动封面。")}</p>}
      <div className="recording-cover-grid">
        {data.candidates.map((candidate) => {
          const name = tracks.find((track) => track.sourceTrackId === candidate.sourceTrackId)?.displayName || sourceName(candidate.providerInstanceId);
          return <label className={`recording-cover-choice ${selected === candidate.objectId ? "selected" : ""}`} key={candidate.objectId}>
            <input type="radio" name="recording-cover" checked={selected === candidate.objectId} onChange={() => setSelected(candidate.objectId)}
              aria-label={tr("选择 {0} 的封面", { 0: name })} />
            <Cover large objectId={candidate.objectId} />
            <strong>{name}</strong><span>{sourceName(candidate.providerInstanceId)}</span>
            <small>{candidate.width && candidate.height ? `${candidate.width} × ${candidate.height}` : tr("尺寸未知")}</small>
            {candidate.objectId === data.coverObjectId && <small className="recording-cover-current">{tr("当前封面")}</small>}
          </label>;
        })}
      </div>
      {!data.candidates.length && <Empty title={tr("暂无可选封面")} />}
    </fieldset>}
    <div className="list-actions">
      {conflict ? <button onClick={reload}>{tr("刷新封面后重新选择")}</button> :
        <button className="primary" disabled={!canSave} onClick={() => void save()}>
          {tr(busy ? "正在保存…" : retryable ? "继续确认封面选择" : "保存封面")}
        </button>}
      <button disabled={busy} onClick={close}>{tr("取消")}</button>
    </div>
  </Modal>;
}
