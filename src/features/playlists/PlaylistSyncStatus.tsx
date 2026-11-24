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

export function PlaylistSyncStatus({ jobId, finished, start, synced }: {
  jobId?: string; finished?: (signal: AbortSignal, job?: SyncJob, playlist?: RemotePlaylist) => Promise<void> | void;
  start?: (signal: AbortSignal, knownPlaylistId?: string) => Promise<{ jobId: string }>;
  synced?: () => Promise<void> | void;
}) {
  const s = useServices();
  const [currentId, setCurrentId] = useState(jobId);
  const [job, setJob] = useState<SyncJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submission = useRef<AbortController | null>(null);
  const retry = useRef<() => void>(undefined);
  const observedProgress = useRef(false);
  const onFinish = useEffectEvent(async (signal: AbortSignal, job?: SyncJob, playlist?: RemotePlaylist) => {
    if (job?.state === "succeeded" && observedProgress.current) {
      observedProgress.current = false;
      await synced?.();
    }
    if (!signal.aborted) await finished?.(signal, job, playlist);
  });
  useEffect(() => () => submission.current?.abort(), []);
  useEffect(() => {
    if (!currentId) return;
    let terminal: SyncJob | null = null;
    let reported = false;
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
      observedProgress.current = true;
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
        if (next.state === "queued" || next.state === "running") {
          observedProgress.current = true;
        } else {
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
    if (submission.current) return;
    const submit = start ?? (job?.playlistId ? async (signal: AbortSignal) =>
      s.content.sync(await s.content.remotePlaylist(job.playlistId, signal), signal) : undefined);
    if (!submit) return;
    const request = new AbortController();
    submission.current = request;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const next = await submit(request.signal, job?.playlistId);
      if (request.signal.aborted) return;
      observedProgress.current = true;
      if (next.jobId !== currentId) setJob(null);
      else retry.current?.();
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
  const active = !!currentId && (!error || !!job) && (state === "queued" || state === "running");
  const retryable = state === "failed" || state === "cancelled";
  return <>
    {currentId && (!error || job) && <p role="status">{tr("同步状态：")}{tr(states[state] ?? state)}
      {failed && <> · {syncFailureMessage(failed.code)}{" "}
        {failed.code === "RATE_LIMITED" && Number(failed.retryAfter) > 0 &&
          <>{tr("平台给出的冷却时长为 {0} 秒。", { 0: failed.retryAfter! })}{" "}</>}
        <small>({failed.code})</small></>}
    </p>}
    {(start || job?.playlistId && retryable) &&
      <button type="button" disabled={submitting || active} onClick={() => void resubmit()}>
        {tr(submitting ? "正在提交…" : retryable ? "重试同步" : "立即同步")}
      </button>}
    <ErrorNotice error={submitError} />
    <ErrorNotice error={error} retry={() => retry.current?.()} />
  </>;
}
