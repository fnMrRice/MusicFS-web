import { ApiError, errorMessage } from "../api/client";
import type { Task } from "../api/tasks";
import { ErrorNotice } from "../components/ui";
import { tr } from "../i18n";
import styles from "./TaskQueue.module.css";
import { refreshError } from "../tasks/refresh-errors";

const refreshLabels: Record<Task["status"], string> = {
  queued: "等待刷新", running: "正在刷新", cancelling: "正在中断…", succeeded: "刷新完成", failed: "刷新未完成", cancelled: "已取消",
};
const jobLabels: Record<Task["status"], string> = {
  queued: "任务等待执行", running: "任务正在执行", cancelling: "正在中断…", succeeded: "已完成", failed: "任务失败", cancelled: "已取消",
};
export function TaskQueueItem({ task, showOwner, cancelling, error, cancel }: {
  task: Task; showOwner: boolean; cancelling: boolean; error: string | null; cancel: () => void;
}) {
  const refresh = task.kind === "metadataRefresh";
  const title = refresh ? task.roots.map(root => root.name).join(" · ") : tr(task.kind === "bulkMerge" ? "一键合并重复音乐" : "专辑自动刮削");
  const metadata = task.phase === "metadata";
  const terminal = task.phase === "finished";
  const cancellation = ["cancelled", "cancelling"].includes(task.status) && ["CANCELED", "CANCELLED"].includes(task.error?.code ?? "");
  const taskError = task.error && new ApiError(task.error.code, task.error.message, 0, task.error.requestId);
  return <li className={styles.item} data-task-id={task.id}>
    <div className={styles.itemHeader}>
      <strong>{title}</strong>
      <span className={styles[task.status]}>{tr((refresh ? refreshLabels : jobLabels)[task.status])}</span>
    </div>
    {(refresh || showOwner) && <p className={styles.context}>{[refresh && task.providerName, showOwner && task.ownerName].filter(Boolean).join(" · ")}</p>}
    {task.phase === "scanning" && <p>{tr("正在读取音乐文件 · 已发现 {0} 首", { 0: task.progress.observed })}</p>}
    {metadata && <>
      <p>{tr("正在更新歌曲信息、封面和歌词 · {0}/{1}", { 0: task.progress.metadataCompleted, 1: task.progress.metadataTotal })}</p>
      {task.progress.metadataTotal > 0 && <progress aria-label={tr("目录刷新进度")}
        max={task.progress.metadataTotal} value={task.progress.metadataCompleted} />}
    </>}
    {task.phase === "scraping" && <p>{tr("已处理 {0}/{1} 张专辑", { 0: task.progress.completed, 1: task.progress.total })}</p>}
    {task.phase === "scraping" && task.progress.total > 0 && <progress aria-label={tr("任务进度")} max={task.progress.total} value={task.progress.completed} />}
    {terminal && task.kind !== "bulkMerge" && <p>{tr("更新 {0} · 保留 {1} · 未找到 {2} · 失败 {3}", {
      0: task.result.updated, 1: task.result.retained, 2: task.result.notFound, 3: task.result.failed,
    })}</p>}
    {task.kind === "bulkMerge" && task.status === "succeeded" && <>
      <p>{task.result.mergedGroups ? tr("已合并 {0} 组重复音乐，涉及 {1} 个来源版本。", { 0: task.result.mergedGroups, 1: task.result.mergedSources })
        : tr("没有可合并的重复音乐。")}</p>
      {task.result.skippedGroups > 0 && <p>{tr("已跳过 {0} 个存在排除、冲突或超限的分组。", { 0: task.result.skippedGroups })}</p>}
    </>}
    {refresh && terminal && task.status === "cancelled" && <p className={styles.context}>{tr("已完成的刷新结果仍会保留。")}</p>}
    {taskError && !cancellation && <ErrorNotice error={refresh ? refreshError(taskError) : errorMessage(taskError)} />}
    {!task.error && task.kind !== "bulkMerge" && task.result.failed > 0 && <p className={styles.failure}>{tr("部分内容未能更新，请检查来源状态。")}</p>}
    <ErrorNotice error={error} retry={cancel} />
    {task.cancellable && <div className={styles.actions}>
      <button type="button" disabled={cancelling || task.cancelRequested} onClick={cancel}
        aria-label={refresh ? tr(task.status === "queued" ? "取消目录 {0} 的刷新" : "中断目录 {0} 的刷新", { 0: task.roots[0].name }) : tr("取消任务 {0}", { 0: title })}>
        {tr(cancelling || task.cancelRequested ? "正在中断…" : task.status === "queued" ? "取消" : "中断")}
      </button>
    </div>}
  </li>;
}
