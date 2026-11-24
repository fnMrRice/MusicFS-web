import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import type { RemotePlaylist, SyncJob } from "../../api/content";
import { useServices } from "../../app/services";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { syncFailureMessage } from "./sync-error";

const states: Record<string, string> = {
  queued: "排队中", running: "同步中", succeeded: "已完成", failed: "失败", cancelled: "已取消",
};

export function PlaylistSyncStatus({ jobId, finished, showRetry = true, pending }: {
  jobId: string; finished?: (signal: AbortSignal, job?: SyncJob, playlist?: RemotePlaylist) => Promise<void> | void;
  showRetry?: boolean; pending?: () => void;
}) {
  const s = useServices();
  const [currentId, setCurrentId] = useState(jobId);
  const [job, setJob] = useState<SyncJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submission = useRef<AbortController | null>(null);
  const retry = useRef<() => void>(undefined);
  const onFinish = useEffectEvent((signal: AbortSignal, job?: SyncJob, playlist?: RemotePlaylist) => finished?.(signal, job, playlist));
  const onPending = useEffectEvent(() => pending?.());
  useEffect(() => () => submission.current?.abort(), []);
  useEffect(() => {
    let terminal: SyncJob | null = null;
    let reported = false;
    onPending();
    // 旧任务保持失败状态；关联歌单在重新授权、冷却结束或另一标签页重试后会指向新任务。
    async function followReplacement(previous: SyncJob, signal: AbortSignal) {
      const latest = await s.content.remotePlaylist(previous.playlistId, signal);
      if (signal.aborted) return;
      if (!latest.jobId || latest.jobId === currentId) {
        if (!reported) {
          await onFinish(signal, previous, latest);
          reported = true;
        }
        return;
      }
      setCurrentId(latest.jobId);
      setJob(null);
      setError(null);
      setSubmitError(null);
    }
    const watcher = s.activity.watch("playlistSync", async signal => {
      try {
        if (terminal) {
          await followReplacement(terminal, signal);
          if (!signal.aborted) setError(null);
          return;
        }
        let next: SyncJob;
        try {
          next = await s.content.syncJob(currentId, signal);
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 404 && !signal.aborted) {
            await onFinish(signal);
            watcher.stop();
            setError(errorMessage(cause));
            return;
          }
          throw cause;
        }
        if (signal.aborted) return;
        setJob(next);
        setError(null);
        if (next.state !== "queued" && next.state !== "running") {
          if ((next.state === "failed" || next.state === "cancelled") && next.playlistId) {
            terminal = next;
            await followReplacement(next, signal);
            return;
          }
          await onFinish(signal, next);
          watcher.stop();
        }
      } catch (cause) {
        if (signal.aborted) return;
        setError(errorMessage(cause));
      }
    });
    retry.current = watcher.refresh;
    return watcher.stop;
  }, [s, currentId]);
  async function resubmit() {
    if (!job?.playlistId || submission.current) return;
    const request = new AbortController();
    submission.current = request;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const playlist = await s.content.remotePlaylist(job.playlistId, request.signal);
      if (request.signal.aborted) return;
      const next = await s.content.sync(playlist);
      if (request.signal.aborted) return;
      setJob(null);
      setError(null);
      setCurrentId(next.jobId);
    } catch (cause) {
      if (!request.signal.aborted) setSubmitError(cause instanceof ApiError && cause.code === "RATE_LIMITED"
        ? tr("请求过于频繁，请稍后再试。") : errorMessage(cause));
    } finally {
      submission.current = null;
      if (!request.signal.aborted) setSubmitting(false);
    }
  }
  const state = job?.state ?? "queued";
  const failed = job?.error;
  return <>
    {(!error || job) && <p role="status">{tr("同步状态：")}{tr(states[state] ?? state)}
      {failed && <> · {syncFailureMessage(failed.code)}{" "}
        {failed.code === "RATE_LIMITED" && Number(failed.retryAfter) > 0 &&
          <>{tr("平台给出的冷却时长为 {0} 秒。", { 0: failed.retryAfter! })}{" "}</>}
        <small>({failed.code})</small></>}
    </p>}
    {showRetry && job?.playlistId && (state === "failed" || state === "cancelled") &&
      <button type="button" disabled={submitting} onClick={() => void resubmit()}>{tr(submitting ? "正在提交…" : "重试同步")}</button>}
    <ErrorNotice error={submitError} />
    <ErrorNotice error={error} retry={() => retry.current?.()} />
  </>;
}
