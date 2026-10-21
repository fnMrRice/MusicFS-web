import type { PluginJob } from "../../api/plugin-settings";
import { tr } from "../../i18n";

export function PluginJobStatus({ job }: { job?: PluginJob }) {
  if (!job || job.status === "idle") return null;
  const messages = { queued: "任务等待执行", running: "任务正在执行", succeeded: "任务已完成", failed: "任务失败，可重新执行" };
  return <div className="plugin-job" role="status" aria-live="polite">
    <strong>{tr(messages[job.status])}</strong>
    <p>{tr("已处理 {0} / {1} 首曲目", { 0: job.processed, 1: job.total })}
      {job.candidates !== undefined ? ` · ${tr("发现 {0} 对候选", { 0: job.candidates })}` : ""}</p>
    {job.status === "running" && job.total > 0 && <progress value={job.processed} max={job.total} aria-label={tr("任务进度")} />}
    {job.status === "failed" && <p className="muted">{tr("请检查插件是否启用，以及音乐源是否可用，然后重试。")}</p>}
  </div>;
}
