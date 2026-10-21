import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { MatchingApi, type MatchCandidate } from "../../api/matching";
import { useServices, useStore } from "../../app/services";
import { Modal } from "../../components/Modal";
import { usePages } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { MergeSongs } from "./MergeSongs";
import { TrackEvidence } from "./TrackEvidence";
import { useDecision } from "./useDecision";

const reasonLabels: Record<string, string> = {
  verifiedFileSHA512Equal: "文件内容相同", fingerprintSimilar: "音频指纹相近", titleEqual: "曲名相近",
  artistOverlap: "歌手相同", metadataOnly: "曲目信息相近", durationClose: "时长相近",
};

export function Candidates({ close, refresh }: { close: () => void; refresh: () => void }) {
  useLocale();
  const services = useServices();
  const auth = useStore(services.auth);
  const matchingPending = useStore(services.matchingDecisions.pending);
  const revision = useRef<number | null>(null);
  const pages = usePages("matching-candidates", async (after, signal) => {
    const page = await new MatchingApi(services.client).candidates(after, signal);
    if (after && revision.current !== page.revision) throw new ApiError("CURSOR_EXPIRED", "Matching revision changed");
    revision.current = page.revision;
    return { items: page.items, cursor: page.nextAfter };
  }, (candidate) => candidate.candidateId);
  const [merge, setMerge] = useState<{ candidate: MatchCandidate; revision: number } | null>(null);
  const decision = useDecision(() => pages.reload());
  const reload = () => { decision.reset(); pages.reload(); };
  return <Modal title={tr("重复识别")} close={() => { if (!decision.busy) close(); }}>
    <p>{tr("插件自动找出疑似重复歌曲。确认属于同一录音后再合并；现场版、翻唱和不同录音可选择排除。")}</p>
    <p className="muted">{tr("评分表示优先核对顺序，不是相同概率。")}</p>
    <div className="list-actions">
      <button disabled={pages.loading || decision.busy} onClick={reload}>{tr("刷新候选")}</button>
      {auth.session?.user.role === "admin" && <Link to="/settings?tab=plugins" onClick={close}>{tr("打开插件设置")}</Link>}
    </div>
    <ErrorNotice error={pages.error} retry={pages.retry} />
    <DecisionError decision={decision} reload={reload} />
    <div className="matching-candidates">
      {pages.items.map((candidate) => <article className="matching-candidate" key={candidate.candidateId}>
        <div className="matching-pair"><TrackEvidence track={candidate.leftTrack} /><TrackEvidence track={candidate.rightTrack} /></div>
        <div className="matching-reasons"><span className="badge">{tr("核对评分：{0}", { 0: candidate.score })}</span>
          {candidate.reasons.map((reason, index) => <span className="badge" key={index}>
            {tr(reasonLabels[reason.kind] ?? "匹配证据")}
            {reason.durationDifferenceMs !== undefined ? ` · ${tr("时长相差 {0} 秒", { 0: (reason.durationDifferenceMs / 1000).toFixed(1) })}` : ""}
          </span>)}
        </div>
        <div className="list-actions">
          <button className="primary" disabled={decision.busy || decision.conflict || decision.retryable || pages.loading || matchingPending.length > 0}
            onClick={() => { if (revision.current !== null) setMerge({ candidate, revision: revision.current }); }}>{tr("合并歌曲")}</button>
          <button disabled={decision.busy || decision.conflict || decision.retryable || pages.loading || matchingPending.length > 0}
            onClick={() => { if (revision.current !== null) void decision.run({ kind: "exclusions", expectedRevision: revision.current,
              leftSourceTrackId: candidate.left.sourceTrackId, rightSourceTrackId: candidate.right.sourceTrackId, excluded: true }); }}>{tr("不是同一录音")}</button>
        </div>
      </article>)}
    </div>
    {!pages.loading && !pages.error && !pages.items.length && !pages.cursor && <p role="status">{tr(auth.session?.user.role === "admin"
      ? "暂无待确认的重复歌曲。可在插件设置中开启自动识别或立即识别。" : "暂无待确认的重复歌曲。")}</p>}
    {pages.loading && <p role="status">{tr("正在加载…")}</p>}
    {pages.cursor && <button disabled={pages.loading || decision.busy} onClick={pages.more}>{tr("加载更多")}</button>}
    {merge && <MergeSongs tracks={[merge.candidate.leftTrack, merge.candidate.rightTrack]} revision={merge.revision}
      close={() => setMerge(null)} refresh={() => { refresh(); pages.reload(); }} />}
  </Modal>;
}

function DecisionError({ decision, reload }: { decision: ReturnType<typeof useDecision>; reload: () => void }) {
  return <><ErrorNotice error={decision.error} />
    {decision.retryable && <button disabled={decision.busy} onClick={() => { void decision.run(); }}>{tr("重试")}</button>}
    {decision.conflict && <button onClick={reload}>{tr("刷新列表并重新选择")}</button>}
  </>;
}
