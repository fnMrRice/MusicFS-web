import { useEffect, useState } from "react";
import type { SourceTrack } from "../../api/types";
import { MatchingApi } from "../../api/matching";
import { useServices, useStore } from "../../app/services";
import { useSourceName } from "../../components/use-source-name";
import { duration, ErrorNotice, Icon } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { tr, useLocale } from "../../i18n";
import { useDecision } from "./useDecision";
import { TrackDetails } from "./TrackDetails";

export function TrackVersions({ tracks, revision, refresh, recordingId, defaultSourceTrackId, manualSourceTrackId }: {
  tracks: SourceTrack[]; revision?: number; refresh?: () => void;
  recordingId?: string | null; defaultSourceTrackId: string; manualSourceTrackId?: string | null;
}) {
  useLocale();
  const services = useServices();
  const matchingPending = useStore(services.matchingDecisions.pending);
  const sourceName = useSourceName();
  const [unlink, setUnlink] = useState<{ track: SourceTrack; revision?: number } | null>(null);
  const [details, setDetails] = useState<SourceTrack | null>(null);
  const canChooseDefault = !!recordingId && !!refresh;
  const current = useResource(`default-source-revision-${recordingId}-${revision}`, (signal) =>
    revision === undefined && canChooseDefault ? new MatchingApi(services.client).revision(signal) : Promise.resolve({ revision }));
  const decision = useDecision(() => { current.reload(); refresh?.(); });
  useEffect(() => {
    // 页面顶部确认完成后，同步清理仍展开的版本列表中的待确认状态。
    if (decision.retryable && !decision.busy && matchingPending.length === 0) decision.reset();
  }, [decision.retryable, decision.busy, matchingPending]);
  const blocked = decision.busy || decision.conflict || decision.retryable || matchingPending.length > 0 || current.data?.revision === undefined;
  function chooseDefault(sourceTrackId: string | null) {
    if (!blocked && recordingId && current.data?.revision !== undefined) void decision.run({
      kind: "default-source", recordingId, sourceTrackId, expectedRevision: current.data.revision,
    });
  }
  return <div className="track-versions-list" aria-label={tr("来源版本")} aria-busy={decision.busy}>
    <p className="muted track-version-policy">{tr("自动选择可用版本中码率最高的；码率相同时选择较大的文件。手动默认优先。")}</p>
    {tracks.map((track) => <div className="track-version" key={track.sourceTrackId}>
      <span className="track-version-name">{track.displayName}</span>
      {track.sourceTrackId === defaultSourceTrackId && <span className="track-version-default">
        {tr(manualSourceTrackId === track.sourceTrackId ? "手动默认" : "自动默认")}
      </span>}
      <span>{sourceName(track.providerInstanceId)}</span>
      <span className="format">{(track.container || track.codec)?.toUpperCase() || "—"}</span>
      <span className="track-version-quality" title={tr("文件大小：{0}", { 0: validSize(track.asset?.fileSizeBytes) ? `${track.asset!.fileSizeBytes} B` : tr("大小未知") })}>
        {bitrate(track.bitrateBps)} · {fileSize(track.asset?.fileSizeBytes)}
      </span>
      <span>{duration(track.durationMs)}</span>
      <div className="track-version-actions">
        {canChooseDefault && (manualSourceTrackId === track.sourceTrackId ?
          <button disabled={blocked} onClick={() => chooseDefault(null)} aria-label={tr("取消默认版本")}>{tr("取消默认")}</button> :
          <button disabled={blocked} onClick={() => chooseDefault(track.sourceTrackId)}
            aria-label={tr("将 {0} 设为默认版本", { 0: track.displayName })}>{tr("设为默认")}</button>)}
        <button onClick={() => setDetails(track)} aria-label={tr("查看 {0} 的详情", { 0: track.displayName })}>{tr("详情")}</button>
        <button disabled={track.availability !== "available"} onClick={() => services.play(track)}
          aria-label={tr("播放来源版本 {0}", { 0: track.displayName })}><Icon name="play" size={14} /> {tr("播放")}</button>
        {refresh && <button disabled={matchingPending.length > 0} onClick={() => setUnlink({ track, revision })} aria-label={tr("解除 {0} 的关联", { 0: track.displayName })}>{tr("解除关联")}</button>}
      </div>
    </div>)}
    {canChooseDefault && <ErrorNotice error={current.error} retry={current.reload} />}
    <ErrorNotice error={decision.error} />
    {decision.retryable && <button className="text-button" disabled={decision.busy} onClick={() => void decision.run()}>{tr("重试")}</button>}
    {decision.conflict && <button className="text-button" onClick={() => { decision.reset(); current.reload(); refresh?.(); }}>{tr("刷新列表并重新选择")}</button>}
    {details && <TrackDetails key={`${details.providerInstanceId}-${details.sourceTrackId}`}
      sourceTrackId={details.sourceTrackId} providerInstanceId={details.providerInstanceId} close={() => setDetails(null)} />}
    {unlink && refresh && <UnlinkSong track={unlink.track} revision={unlink.revision} refresh={refresh} close={() => setUnlink(null)} />}
  </div>;
}

function bitrate(value: number | null): string {
  return value !== null && Number.isFinite(value) && value > 0 ? `${Math.round(value / 100) / 10} kbps` : tr("码率未知");
}
function validSize(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function fileSize(value: number | null | undefined): string {
  if (!validSize(value)) return tr("大小未知");
  if (value < 1024) return `${value} B`;
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(2)} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}

function UnlinkSong({ track, revision, refresh, close }: { track: SourceTrack; revision?: number; refresh: () => void; close: () => void }) {
  const services = useServices();
  const current = useResource(`unlink-revision-${revision}`, (signal) => revision === undefined
    ? new MatchingApi(services.client).revision(signal) : Promise.resolve({ revision }));
  const decision = useDecision(() => { refresh(); close(); });
  return <Modal title={tr("解除关联")} close={() => { if (!decision.busy) close(); }}>
    <p>{tr("解除后，此来源将在曲目列表中单独显示。原文件不会改变。")}</p>
    <p>{track.displayName}</p>
    <ErrorNotice error={current.error} retry={current.reload} />
    <ErrorNotice error={decision.error} />
    <div className="list-actions">
      {decision.conflict ? <button onClick={() => { refresh(); close(); }}>{tr("刷新列表并重新选择")}</button> :
        <button className="primary" disabled={decision.busy || !current.data} onClick={() => {
          if (current.data) void decision.run({ kind: "unlinks", sourceTrackId: track.sourceTrackId, expectedRevision: current.data.revision });
        }}>{decision.busy ? tr("正在保存…") : decision.retryable ? tr("重试") : tr("确认解除")}</button>}
      <button disabled={decision.busy} onClick={close}>{tr("取消")}</button>
    </div>
  </Modal>;
}
