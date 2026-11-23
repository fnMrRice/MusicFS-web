import { useEffect, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import type { OnlineTrack } from "../../api/content";
import { getDownloadJob, getDownloadSummary, type DownloadJob, type DownloadOptions, type DownloadSummary } from "../../api/online-downloads";
import { useServices, useStore } from "../../app/services";
import { Store } from "../../app/store";
import { ErrorNotice } from "../../components/ui";
import { localizedPluginText } from "../../components/source-name";
import { statusText, tr, useLocale } from "../../i18n";
import { versionLabel } from "../library/SourceDownloads";

interface Receipt { id: string; quality: DownloadOptions["options"][number]; initial?: DownloadJob }
const histories = new Map<string, Store<Receipt[]>>();
const storageKey = (scope: string) => "musicfs:playlist-downloads:" + scope;

function history(scope: string) {
  let result = histories.get(scope);
  if (!result) {
    let receipts: Receipt[] = [];
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey(scope)) ?? "[]");
      if (Array.isArray(saved)) receipts = saved.filter(item => item && typeof item.id === "string" &&
        typeof item.quality?.label === "string").map(({ id, quality }) => ({ id, quality }));
    } catch { /* 浏览器禁止会话存储时仍可查看本页任务。 */ }
    result = new Store(receipts);
    histories.set(scope, result);
  }
  return result;
}

function updateHistory(scope: string, receipts: Receipt[]) {
  history(scope).set(receipts);
  try {
    if (receipts.length) sessionStorage.setItem(storageKey(scope), JSON.stringify(receipts.map(({ id, quality }) => ({ id, quality }))));
    else sessionStorage.removeItem(storageKey(scope));
  } catch { /* 当前页面继续保留任务回执。 */ }
}

export function rememberDownload(scope: string, job: DownloadJob, quality: Receipt["quality"]) {
  updateHistory(scope, [{ id: job.jobId, initial: job, quality }, ...history(scope).value.filter(item => item.id !== job.jobId)]);
}

function forgetDownload(scope: string, id: string) {
  updateHistory(scope, history(scope).value.filter(receipt => receipt.id !== id));
}

const stateLabels = {
  queued: "排队中", running: "正在下载", succeeded: "已完成", partial: "部分下载失败", failed: "失败",
};
const finished = (job: DownloadSummary) => job.state !== "queued" && job.state !== "running";

function JobStatus({ scope, receipt, tracks }: { scope: string; receipt: Receipt; tracks: Map<string, OnlineTrack> }) {
  const { client } = useServices();
  const { locale } = useLocale();
  const [job, setJob] = useState<DownloadSummary | undefined>(receipt.initial);
  const [items, setItems] = useState<DownloadJob["items"]>();
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(50);
  useEffect(() => {
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let previous: DownloadSummary | undefined;
    async function read() {
      try {
        let result = await getDownloadSummary(client, receipt.id, request.signal);
        if (request.signal.aborted) return;
        if (expanded && (previous?.state !== result.state || previous.completed !== result.completed || previous.failed !== result.failed)) {
          const detail = await getDownloadJob(client, receipt.id, request.signal);
          if (request.signal.aborted) return;
          setItems(detail.items);
          result = detail;
        }
        if (request.signal.aborted) return;
        previous = result;
        setJob(result);
        setError(null);
        if (!finished(result)) timer = setTimeout(() => void read(), 1500);
      } catch (cause) {
        if (request.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 404) forgetDownload(scope, receipt.id);
        else setError(errorMessage(cause));
      }
    }
    void read();
    return () => { request.abort(); clearTimeout(timer); };
  }, [client, scope, receipt.id, retry, expanded]);
  return <div className="online-download-job">
    {job && <>
      <p role="status"><strong>{tr(stateLabels[job.state])}</strong>{" · "}
        {tr("所选音质 {0}", { 0: localizedPluginText(receipt.quality.label, receipt.quality.localizedLabels, locale) })}{" · "}
        {tr("共 {total} 首，已下载 {done} 首，失败 {failed} 首", { total: job.total, done: job.completed, failed: job.failed })}
      </p>
      <button type="button" className="text-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {tr(expanded ? "收起下载明细" : "查看下载明细")}</button>
      {finished(job) && <button type="button" className="text-button" onClick={() => forgetDownload(scope, receipt.id)}>
        {tr("移除此任务记录")}</button>}
      {expanded && !items && !error && <span role="status">{tr("正在读取下载任务…")}</span>}
      {expanded && items && <ul className="online-download-results">
        {items.slice(0, visible).map(item => <li key={item.externalId}>
          <strong>{tracks.get(item.externalId)?.title ?? item.externalId}</strong>{" · "}{tr(stateLabels[item.state])}
          {item.version && <> · {tr("实际版本 {0}", { 0: versionLabel(item.version) })}</>}
          {item.error && <> · {item.error.code === "AUDIO_CACHE_DISABLED" ? tr("请在插件设置中将音频缓存上限设为大于 0。") :
            statusText(errorMessage(new ApiError(item.error.code, item.error.message)))} ({item.error.code})</>}
        </li>)}
      </ul>}
      {expanded && items && visible < items.length && <button type="button" onClick={() => setVisible(n => n + 50)}>
        {tr("显示更多下载结果")}</button>}
    </>}
    {!job && !error && <span role="status">{tr("正在读取下载任务…")}</span>}
    <ErrorNotice error={error} retry={() => setRetry(n => n + 1)} />
  </div>;
}

export function OnlineDownloadJobs({ scope, tracks }: { scope: string; tracks: Map<string, OnlineTrack> }) {
  const receipts = useStore(history(scope));
  return receipts.length ? <section className="online-download-jobs" aria-label={tr("歌单下载任务")}>
    <h3>{tr("歌单下载任务")}</h3>
    {receipts.map(receipt => <JobStatus key={receipt.id} scope={scope} receipt={receipt} tracks={tracks} />)}
  </section> : null;
}
