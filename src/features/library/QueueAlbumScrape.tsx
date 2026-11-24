import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { useCatalogTask } from "../../tasks/use-catalog-task";

export function QueueAlbumScrape({ provider, query }: { provider: string; query: string }) {
  const job = useCatalogTask();
  return <>
    <button type="button" disabled={job.busy || job.active} title={tr("自动刮削当前来源和搜索条件下的所有未刮削专辑")}
      onClick={() => void job.submit({ kind: "albumAutoScrape", ...(provider === "all" ? {} : { providerInstanceId: provider }),
        ...(query && { q: query }) })}>
      {tr(job.busy ? "正在加入队列…" : job.retryable ? "继续确认" : "一键自动刮削")}
    </button>
    {job.submitted && <span role="status">{tr("已加入任务队列")}</span>}
    <ErrorNotice error={job.error} />
  </>;
}
