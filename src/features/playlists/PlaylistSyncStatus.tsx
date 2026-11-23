import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import type { SyncJob } from "../../api/content";
import { useServices } from "../../app/services";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";

const states: Record<string, string> = {
  queued: "排队中", running: "同步中", succeeded: "已完成", failed: "失败", cancelled: "已取消",
};

export function PlaylistSyncStatus({ jobId, finished }: {
  jobId: string; finished?: (signal: AbortSignal) => Promise<void> | void;
}) {
  const s = useServices();
  const [job, setJob] = useState<SyncJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<() => void>(undefined);
  const onFinish = useEffectEvent((signal: AbortSignal) => finished?.(signal));
  useEffect(() => {
    const watcher = s.activity.watch("playlistSync", async signal => {
      try {
        let next: SyncJob;
        try {
          next = await s.content.syncJob(jobId, signal);
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
          await onFinish(signal);
          watcher.stop();
        }
      } catch (cause) {
        if (signal.aborted) return;
        setError(errorMessage(cause));
      }
    });
    retry.current = watcher.refresh;
    return watcher.stop;
  }, [s, jobId]);
  const state = job?.state ?? "queued";
  return <><p role="status">{tr("同步状态：")}{tr(states[state] ?? state)}
    {job?.error && `（${job.error.code}）`}
  </p><ErrorNotice error={error} retry={() => retry.current?.()} /></>;
}
