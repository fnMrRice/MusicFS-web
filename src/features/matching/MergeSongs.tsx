import { useMemo } from "react";
import { MatchingApi, mergeRequest, selectedVersions } from "../../api/matching";
import type { SourceTrack } from "../../api/types";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { TrackEvidence } from "./TrackEvidence";
import { useDecision } from "./useDecision";

export function MergeSongs({ tracks, revision, close, refresh }: {
  tracks: SourceTrack[]; revision?: number; close: () => void; refresh: () => void;
}) {
  useLocale();
  const services = useServices();
  const current = useResource(`merge-revision-${revision}`, (signal) => revision === undefined
    ? new MatchingApi(services.client).revision(signal) : Promise.resolve({ revision }));
  const sources = useMemo(() => selectedVersions(tracks), [tracks]);
  const decision = useDecision(() => { refresh(); close(); });
  const reload = () => { refresh(); close(); };
  return <Modal title={tr("合并歌曲")} close={() => { if (!decision.busy) close(); }}>
    <p>{tr("将所选歌曲关联为同一录音，在曲目列表中合成一行。所有来源和原文件都会保留。")}</p>
    <div className="matching-selected">{sources.map((track) => <TrackEvidence key={track.sourceTrackId} track={track} />)}</div>
    {sources.length > 256 && <p role="alert">{tr("一次最多合并 256 个来源版本，请减少选择。")}</p>}
    <ErrorNotice error={current.error} retry={current.reload} />
    <ErrorNotice error={decision.error} />
    <div className="list-actions">
      {decision.conflict ? <button onClick={reload}>{tr("刷新列表并重新选择")}</button> :
        <button className="primary" disabled={decision.busy || !current.data || sources.length < 2 || sources.length > 256}
          onClick={() => { if (current.data) void decision.run(mergeRequest(tracks, current.data.revision)); }}>
          {decision.busy ? tr("正在保存…") : decision.retryable ? tr("重试") : tr("确认合并")}
        </button>}
      <button disabled={decision.busy} onClick={close}>{tr("取消")}</button>
    </div>
  </Modal>;
}
