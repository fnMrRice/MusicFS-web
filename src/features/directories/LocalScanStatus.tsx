import type { LocalScanSnapshot, LocalScanState } from "../../library/local-scan-state";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { scanFailureReason } from "../../library/scan-errors";

export function LocalScanStatus({ value, state, unavailable }: {
  value: LocalScanSnapshot; state: LocalScanState; unavailable: string | null;
}) {
  const job = value.job;
  const progress = job?.progress.observed ?? 0;
  const messages = {
    queued: "扫描已排队，正在等待开始…",
    running: "正在扫描音乐，已发现 {0} 首曲目…",
    retry_wait: "扫描暂时失败，正在等待自动重试；已发现 {0} 首曲目。",
    succeeded: "扫描完成，共发现 {0} 首曲目。",
  };
  const message = job && (job.status !== "succeeded" || job.complete && !value.pending && !value.refreshing) ? messages[job.status as keyof typeof messages] : null;
  const metadata = value.metadata;
  const reason = value.error && !value.pending && job?.error?.code ? scanFailureReason(job.error.code) : null;
  return <div className="local-scan-status">
    {value.automaticQueued && <p role="status">{tr("目录已保存，正在等待自动扫描…")}</p>}
    {message && <p role="status">{tr(message, { 0: progress })}</p>}
    {value.refreshing && job?.status === "succeeded" && job.complete && (value.pending || metadata && !metadata.pending) && <p role="status">
      {tr(value.pending ? "正在刷新封面和歌词，已处理 {0}/{1} 首曲目…"
        : metadata?.failed ? "元数据刷新已结束，{0} 首曲目处理失败。" : "元数据刷新完成，共处理 {0} 首曲目。",
      { 0: value.pending ? metadata?.completed ?? 0 : metadata?.failed || progress, 1: metadata?.total ?? progress })}
    </p>}
    {metadata && !metadata.pending && !value.pending && <p className="muted">{tr("封面和歌词：已更新 {0} 项，跳过 {1} 项。",
      { 0: metadata.applied, 1: metadata.skipped })}</p>}
    {value.busy && !job && <p role="status">{tr("正在提交并确认扫描任务…")}</p>}
    <ErrorNotice error={value.error} />
    {reason && <p className="muted">{tr(reason)}</p>}
    {value.error && value.pending && <button type="button" disabled={value.busy} onClick={() => void state.resume()}>
      {tr("继续确认扫描结果")}</button>}
    {!value.pending && !value.busy && unavailable && <p className="muted">{tr(unavailable)}</p>}
  </div>;
}
