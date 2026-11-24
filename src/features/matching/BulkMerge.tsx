import { useState } from "react";
import { bulkMergeRequest, isBulkMergeMutation, MatchingApi, type BulkMergeMode, type BulkMergeMutation } from "../../api/matching";
import { useServices, useStore } from "../../app/services";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { useDecision } from "./useDecision";
import { useCatalogTask } from "../../tasks/use-catalog-task";

export function BulkMergeButton() {
  const services = useServices();
  const pending = useStore(services.matchingDecisions.pending);
  const [open, setOpen] = useState(false);
  return <>
    <button disabled={pending.length > 0} onClick={() => setOpen(true)}>{tr("一键合并重复音乐")}</button>
    {open && <BulkMerge close={() => setOpen(false)} />}
  </>;
}

function BulkMerge({ close }: { close: () => void }) {
  useLocale();
  const services = useServices();
  const pending = useStore(services.matchingDecisions.pending);
  const current = useResource("bulk-merge-revision", (signal) => new MatchingApi(services.client).revision(signal));
  const [mode, setMode] = useState<BulkMergeMode>("score");
  const [minimumScore, setMinimumScore] = useState("80");
  const [result, setResult] = useState<BulkMergeMutation | null>(null);
  const decision = useDecision((response) => { if (isBulkMergeMutation(response)) setResult(response); });
  const job = useCatalogTask();
  const locked = decision.busy || decision.retryable || decision.conflict || pending.length > 0 || job.busy || job.retryable;
  const score = Number(minimumScore);
  const validScore = minimumScore.trim() !== "" && Number.isInteger(score) && score >= 0 && score <= 100;
  return <Modal title={tr("一键合并重复音乐")} close={close}>
    {job.submitted ? <p role="status">{tr("已加入任务队列")}</p> : result ? <BulkMergeSummary result={result} /> : <>
      <p>{tr("处理全部来源中你可见的当前可用曲目，不受当前来源筛选、已加载页或所选曲目限制。所有来源和原文件都会保留。")}</p>
      <fieldset className="bulk-merge-options" disabled={locked}>
        <legend>{tr("合并方式")}</legend>
        <label className="check-label"><input type="radio" name="bulk-merge-mode" value="score" checked={mode === "score"}
          onChange={() => setMode("score")} />{tr("按分数合并")}</label>
        {mode === "score" && <>
          <label className="bulk-merge-score">{tr("最低分数（0–100）")}
            <input type="number" min="0" max="100" step="1" required value={minimumScore}
              onChange={(event) => setMinimumScore(event.target.value)} aria-invalid={!validScore} />
          </label>
          <p className="muted">{tr("合并评分达到最低分数的待确认候选。评分是核对优先级，不是相同概率；请先完成重复识别。")}</p>
          {!validScore && <p role="alert">{tr("最低分数必须是 0 到 100 的整数。")}</p>}
        </>}
        <label className="check-label"><input type="radio" name="bulk-merge-mode" value="title_artist" checked={mode === "title_artist"}
          onChange={() => setMode("title_artist")} />{tr("合并重名重作者")}</label>
        {mode === "title_artist" && <p className="muted">{tr("按规范化后的完整曲名和作者集合相同合并，无需先生成候选；曲名或作者为空的曲目不合并。")}</p>}
      </fieldset>
      <p className="muted">{tr("已排除、存在录音冲突或超过每组 256 个来源版本的分组会跳过。同名同作者仍可能是不同录音，请按需要选择规则。")}</p>
      <p className="muted">{tr("手动解除关联的曲目不会被再次自动合并。")}</p>
      <ErrorNotice error={current.error} retry={locked ? undefined : current.reload} />
      <ErrorNotice error={decision.error} />
      <ErrorNotice error={job.error} />
      {pending.length > 0 && <p role="status">{tr(decision.busy ? "正在合并重复音乐，可离开此页面。" : "请先确认上次歌曲关联操作的结果。")}</p>}
    </>}
    <div className="list-actions">
      {!result && !job.submitted && (decision.conflict ? <button onClick={() => { decision.reset(); current.reload(); }}>
        {tr("刷新曲库并重新确认")}
      </button> : <button className="primary"
        disabled={job.busy || job.retryable || decision.busy || (pending.length > 0 && !decision.retryable) ||
          (!decision.retryable && (!current.data || (mode === "score" && !validScore)))}
        onClick={() => { if (decision.retryable) void decision.run();
          else if (current.data) void decision.run(bulkMergeRequest(mode, current.data.revision, score)); }}>
        {tr(decision.busy ? "正在合并…" : decision.retryable ? "继续确认合并结果" : "开始合并")}
      </button>)}
      {!result && !job.submitted && !decision.conflict && <button type="button"
        disabled={job.busy || (!job.retryable && (locked || !current.data || (mode === "score" && !validScore)))}
        onClick={() => { if (current.data) void job.submit({ kind: "bulkMerge", mode, expectedRevision: current.data.revision,
          ...(mode === "score" ? { minimumScore: score } : {}) }); }}>
        {tr(job.busy ? "正在加入队列…" : job.retryable ? "继续确认" : "加入任务队列")}
      </button>}
      <button onClick={close}>{tr(result || job.submitted || locked ? "关闭" : "取消")}</button>
    </div>
  </Modal>;
}

export function BulkMergeSummary({ result }: { result: BulkMergeMutation }) {
  return <div className="notice bulk-merge-summary" role="status">
    <p>{result.mergedGroups > 0 ? tr("已合并 {0} 组重复音乐，涉及 {1} 个来源版本。", { 0: result.mergedGroups, 1: result.mergedSources }) :
      tr("没有可合并的重复音乐。")}</p>
    {result.skippedGroups > 0 && <p>{tr("已跳过 {0} 个存在排除、冲突或超限的分组。", { 0: result.skippedGroups })}</p>}
  </div>;
}
