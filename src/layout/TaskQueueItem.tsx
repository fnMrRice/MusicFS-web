import { ApiError } from "../api/client";
import type { RefreshTask } from "../api/tasks";
import { ErrorNotice } from "../components/ui";
import { tr } from "../i18n";
import styles from "./TaskQueue.module.css";
import { refreshError } from "../tasks/refresh-errors";

const labels: Record<RefreshTask["status"], string> = {
  queued: "等待刷新", running: "正在刷新", cancelling: "正在中断…", succeeded: "刷新完成", failed: "刷新未完成", cancelled: "已取消",
};
export function TaskQueueItem({ task, showOwner, cancelling, error, cancel }: {
  task: RefreshTask; showOwner: boolean; cancelling: boolean; error: string | null; cancel: () => void;
}) {
  const metadata = task.phase === "metadata";
  const terminal = task.phase === "finished";
  const cancellation = ["cancelled", "cancelling"].includes(task.status) && ["CANCELED", "CANCELLED"].includes(task.error?.code ?? "");
  return <li className={styles.item} data-task-id={task.id}>
    <div className={styles.itemHeader}>
      <strong>{task.roots.map(root => root.name).join(" · ")}</strong>
      <span className={styles[task.status]}>{tr(labels[task.status])}</span>
    </div>
    <p className={styles.context}>{task.providerName}{showOwner && <> · {task.ownerName}</>}</p>
    {task.phase === "scanning" && <p>{tr("正在读取音乐文件 · 已发现 {0} 首", { 0: task.progress.observed })}</p>}
    {metadata && <>
      <p>{tr("正在更新歌曲信息、封面和歌词 · {0}/{1}", { 0: task.progress.metadataCompleted, 1: task.progress.metadataTotal })}</p>
      {task.progress.metadataTotal > 0 && <progress aria-label={tr("目录刷新进度")}
        max={task.progress.metadataTotal} value={task.progress.metadataCompleted} />}
    </>}
    {terminal && <p>{tr("更新 {0} · 保留 {1} · 未找到 {2} · 失败 {3}", {
      0: task.result.updated, 1: task.result.retained, 2: task.result.notFound, 3: task.result.failed,
    })}</p>}
    {terminal && task.status === "cancelled" && <p className={styles.context}>{tr("已完成的刷新结果仍会保留。")}</p>}
    {task.error && !cancellation && <ErrorNotice error={refreshError(new ApiError(task.error.code, task.error.message, 0, task.error.requestId))} />}
    {!task.error && task.result.failed > 0 && <p className={styles.failure}>{tr("部分内容未能更新，请检查来源状态。")}</p>}
    <ErrorNotice error={error} retry={cancel} />
    {task.cancellable && <div className={styles.actions}>
      <button type="button" disabled={cancelling || task.cancelRequested} onClick={cancel}
        aria-label={tr(task.status === "queued" ? "取消目录 {0} 的刷新" : "中断目录 {0} 的刷新", { 0: task.roots[0].name })}>
        {tr(cancelling || task.cancelRequested ? "正在中断…" : task.status === "queued" ? "取消" : "中断")}
      </button>
    </div>}
  </li>;
}
