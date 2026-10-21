import { useState } from "react";
import type { SourceTrack } from "../../api/types";
import { MatchingApi } from "../../api/matching";
import { useServices, useStore } from "../../app/services";
import { useSourceName } from "../../components/use-source-name";
import { duration, ErrorNotice, Icon } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { tr, useLocale } from "../../i18n";
import { useDecision } from "./useDecision";

export function TrackVersions({ tracks, revision, refresh }: {
  tracks: SourceTrack[]; revision?: number; refresh?: () => void;
}) {
  useLocale();
  const services = useServices();
  const matchingPending = useStore(services.matchingDecisions.pending);
  const sourceName = useSourceName();
  const [unlink, setUnlink] = useState<{ track: SourceTrack; revision?: number } | null>(null);
  return <div className="track-versions-list" aria-label={tr("来源版本")}>
    {tracks.map((track) => <div className="track-version" key={track.sourceTrackId}>
      <span className="track-version-name">{track.displayName}</span>
      <span>{sourceName(track.providerInstanceId)}</span>
      <span className="format">{(track.container || track.codec)?.toUpperCase() || "—"}</span>
      <span>{duration(track.durationMs)}</span>
      <div className="track-version-actions">
        <button disabled={track.availability !== "available"} onClick={() => services.play(track)}
          aria-label={tr("播放来源版本 {0}", { 0: track.displayName })}><Icon name="play" size={14} /> {tr("播放")}</button>
        {refresh && <button disabled={matchingPending.length > 0} onClick={() => setUnlink({ track, revision })} aria-label={tr("解除 {0} 的关联", { 0: track.displayName })}>{tr("解除关联")}</button>}
      </div>
    </div>)}
    {unlink && refresh && <UnlinkSong track={unlink.track} revision={unlink.revision} refresh={refresh} close={() => setUnlink(null)} />}
  </div>;
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
