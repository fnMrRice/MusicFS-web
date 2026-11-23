import { useEffect, useState } from "react";
import type { SourceTrack } from "../../api/types";
import { MatchingApi } from "../../api/matching";
import { useServices, useStore } from "../../app/services";
import { useSourceName } from "../../components/use-source-name";
import { duration, ErrorNotice, Icon, IconButton } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { tr, useLocale } from "../../i18n";
import { useDecision } from "./useDecision";
import { TrackDetails } from "./TrackDetails";
import { SourceDownloads } from "../library/SourceDownloads";
import { trackAvailabilityMessage } from "../../library/track-availability";

export function TrackVersions({ tracks, revision, refresh, recordingId, defaultSourceTrackId, manualSourceTrackId, openActions }: {
  tracks: SourceTrack[]; revision?: number; refresh?: () => void;
  recordingId?: string | null; defaultSourceTrackId: string; manualSourceTrackId?: string | null;
  openActions?: (track: SourceTrack, x: number, y: number, origin: HTMLElement) => void;
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
    {tracks.map((track) => <div className="track-version" key={track.sourceTrackId} tabIndex={openActions ? -1 : undefined}
      onContextMenu={openActions ? (event) => {
        event.preventDefault(); event.stopPropagation();
        openActions(track, event.clientX, event.clientY, event.currentTarget);
      } : undefined}
      onKeyDown={openActions ? (event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault(); event.stopPropagation();
          const origin = event.target as HTMLElement;
          const rect = origin.getBoundingClientRect();
          openActions(track, rect.left, rect.bottom, origin);
        }
      } : undefined}>
      <div className="track-version-name">{track.displayName}
        {track.availability !== "available" && <small className="availability">{tr(trackAvailabilityMessage(track.availability))}</small>}
        <SourceDownloads track={track} />
      </div>
      {track.sourceTrackId === defaultSourceTrackId && <span className="track-version-default">
        {tr(manualSourceTrackId === track.sourceTrackId ? "手动默认" : "自动默认")}
      </span>}
      <span>{sourceName(track.providerInstanceId)}</span>
      <span className="format">{(track.container || track.codec)?.toUpperCase() || "—"}</span>
      <span className="track-version-quality" title={tr("文件大小：{0}", { 0: validSize(track.asset?.fileSizeBytes) ? `${track.asset!.fileSizeBytes} B` : tr("大小未知") })}>
        {sampleRate(track.sampleRateHz)} · {bitrate(track.bitrateBps)} · {fileSize(track.asset?.fileSizeBytes)}
      </span>
      <span>{duration(track.durationMs)}</span>
      <div className="track-version-actions">
        <button onClick={() => setDetails(track)} aria-label={tr("查看 {0} 的详情", { 0: track.displayName })}>{tr("详情")}</button>
        {canChooseDefault && (manualSourceTrackId === track.sourceTrackId ?
          <button disabled={blocked} onClick={() => chooseDefault(null)} aria-label={tr("取消默认版本")}>{tr("取消默认")}</button> :
          <button disabled={blocked} onClick={() => chooseDefault(track.sourceTrackId)}
            aria-label={tr("将 {0} 设为默认版本", { 0: track.displayName })}>{tr("设为默认")}</button>)}
        <button disabled={track.availability !== "available"} onClick={() => services.play(track)}
          aria-label={tr("播放来源版本 {0}", { 0: track.displayName })}><Icon name="play" size={14} /> {tr("播放")}</button>
        {openActions && <IconButton icon="more" label={tr("{0} 的更多操作", { 0: track.displayName })} aria-haspopup="menu"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openActions(track, rect.left, rect.bottom, event.currentTarget);
          }} />}
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

function sampleRate(value: number | null | undefined): string {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? `${value / 1000} kHz` : tr("采样率未知");
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
