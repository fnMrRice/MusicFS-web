import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { WorksApi, type ContentType } from "../api/works";
import { useServices } from "../app/services";
import { useResource } from "../components/query";
import { Empty, ErrorNotice } from "../components/ui";
import { formatDate, tr } from "../i18n";
import { RecentTracks } from "./RecentTracks";
import { useLibraryTypes } from "./works/navigation";

export function History() {
  const types = useLibraryTypes();
  const [params, setParams] = useSearchParams();
  const libraries = (types.data ?? []).filter((type) => type.library?.separateHistory)
    .sort((a, b) => a.library!.order - b.library!.order);
  const selected = libraries.find((type) => type.id === params.get("type"));
  return <section aria-label={tr("最近播放")}>
    {libraries.length > 0 && <nav className="tabs" aria-label={tr("播放记录分类")}>
      <button className={selected ? "" : "active"} aria-current={selected ? undefined : "page"}
        onClick={() => setParams({})}>{tr("音乐")}</button>
      {libraries.map((type) => <button key={type.id} className={selected === type ? "active" : ""}
        aria-current={selected === type ? "page" : undefined} onClick={() => setParams({ type: type.id })}>{tr(type.name)}</button>)}
    </nav>}
    <ErrorNotice error={types.error} retry={types.reload} />
    {params.has("type") && types.loading ? <p role="status">{tr("正在加载…")}</p>
      : selected ? <PluginHistory key={selected.id} type={selected} /> : <RecentTracks />}
  </section>;
}

function PluginHistory({ type }: { type: ContentType }) {
  const { client } = useServices();
  const api = useMemo(() => new WorksApi(client), [client]);
  const history = useResource(`content-history:${type.id}`, (signal) => api.history(type.id, signal));
  useEffect(() => {
    const refresh = history.reload;
    window.addEventListener("musicfs:history-changed", refresh);
    return () => window.removeEventListener("musicfs:history-changed", refresh);
  }, [history.reload]);
  if (history.error) return <ErrorNotice error={history.error} retry={history.reload} />;
  if (history.loading) return <p role="status">{tr("正在加载…")}</p>;
  if (!history.data?.length) return <Empty title={tr("暂无播放记录")} icon={type.library?.icon ?? "clock"} />;
  return <ul className="content-history">
    {history.data.map((entry) => <li key={entry.workId + "/" + entry.sourceTrackId}>
      <div><Link to={`/works/${encodeURIComponent(entry.workId)}?contentType=${encodeURIComponent(type.id)}`}>{entry.workTitle}</Link>
        <p className="muted">{entry.trackTitle}</p></div>
      <time dateTime={entry.recordedAt}>{formatDate(entry.recordedAt)}</time>
    </li>)}
  </ul>;
}
