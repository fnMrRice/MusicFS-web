import { useEffect, useMemo } from "react";
import type { ApiClient } from "../../api/client";
import { DirectoriesApi } from "../../api/directories";
import { pendingScanStatuses, type ScanJob } from "../../api/scans";
import { useStore } from "../../app/services";
import { RootStatisticsState } from "../../library/root-statistics";

export function useRootStatistics(client: ApiClient, instance: string, session: string, job: ScanJob | null) {
  const state = useMemo(() => new RootStatisticsState(new DirectoriesApi(client, instance)), [client, instance, session]);
  const snapshot = useStore(state);
  const completed = job && !pendingScanStatuses.includes(job.status) ? `${job.jobId}:${job.status}` : null;
  useEffect(() => {
    void state.refresh();
    return () => state.detach();
  }, [state, job?.jobId, completed]);
  return { ...snapshot, reload: () => { void state.refresh(); } };
}
