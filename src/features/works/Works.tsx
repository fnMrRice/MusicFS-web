import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { WorksApi, type ContentType, type WorkFilters } from "../../api/works";
import { useServices } from "../../app/services";
import { usePages } from "../../components/query";
import { Empty, ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { WorkEditor } from "./WorkEditor";
import { useLibraryTypes } from "./navigation";
import "./works.css";

export function Works() {
  const [params] = useSearchParams();
  const types = useLibraryTypes();
  const id = params.get("contentType");
  if (!id) return <Navigate to="/library" replace />;
  if (types.error) return <ErrorNotice error={types.error} retry={types.reload} />;
  if (types.loading) return <p role="status">{tr("正在加载…")}</p>;
  const type = types.data?.find((item) => item.id === id && item.library);
  if (!type) return <Navigate to="/library" replace />;
  return <WorkList key={id} type={type} />;
}

function WorkList({ type }: { type: ContentType }) {
  useLocale();
  const services = useServices();
  const api = useMemo(() => new WorksApi(services.client), [services]);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters: WorkFilters = { contentType: type.id, q: params.get("q") || "", tag: params.get("tag") || "" };
  const [queryText, setQueryText] = useState(filters.q ?? "");
  const [tagText, setTagText] = useState(filters.tag ?? "");
  useEffect(() => { setQueryText(filters.q ?? ""); setTagText(filters.tag ?? ""); }, [filters.q, filters.tag]);
  const pages = usePages(`works:${JSON.stringify(filters)}`, async (after, signal) => {
    const result = await api.list(filters, after, signal);
    return { items: result.items, cursor: result.nextAfter };
  }, (work) => work.workId);
  const [creating, setCreating] = useState(false);
  const sectionQuery = new URLSearchParams({ contentType: type.id });
  const detailPath = (id: string) => `/works/${encodeURIComponent(id)}?${sectionQuery}`;
  const filtered = Boolean(filters.q || filters.tag);
  return <section className="works-page" aria-label={tr(type.name)}>
    <div className="work-heading work-list-heading">
      {type.description && <p className="muted">{tr(type.description)}</p>}
      <button className="primary" onClick={() => setCreating(true)}>{tr("新建作品")}</button>
    </div>
    <form className="work-filters" onSubmit={(event) => {
      event.preventDefault();
      const next = new URLSearchParams(sectionQuery);
      if (queryText.trim()) next.set("q", queryText.trim());
      if (tagText.trim()) next.set("tag", tagText.trim());
      setParams(next);
    }}>
      <label>{tr("作品关键词")}<input name="q" value={queryText} onChange={(event) => setQueryText(event.target.value)} maxLength={256} /></label>
      <label>{tr("标签筛选")}<input name="tag" value={tagText} onChange={(event) => setTagText(event.target.value)} maxLength={64} /></label>
      <button>{tr("筛选")}</button>
      <button type="button" onClick={pages.reload}>{tr("刷新列表")}</button>
    </form>
    <div className="work-cards">
      {pages.items.map((work) => <Link className="work-card" key={work.workId} to={detailPath(work.workId)}>
        <h3>{work.title}</h3>
        {work.credits.length > 0 && <div className="work-card-credits">{work.credits.slice(0, 3).map((credit, index) =>
          <p className="muted" key={index}><span>{type.creditRoles.find((role) => role.id === credit.role)?.name ?? credit.role}</span>{credit.name}</p>)}
        </div>}
        {work.description && <p className="work-excerpt">{work.description}</p>}
        {!!work.tags.length && <div className="work-tags">{work.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      </Link>)}
    </div>
    <ErrorNotice error={pages.error} retry={pages.retry} />
    {pages.loading && <p role="status">{tr("正在加载…")}</p>}
    {!pages.loading && !pages.error && !pages.items.length && <Empty
      title={tr(filtered ? "还没有符合条件的作品" : "作品库还没有作品")} icon={type.library?.icon ?? "album"}>
      {tr(filtered ? "可以调整筛选条件，或新建一份作品资料。" : "新建第一份作品资料，记录标题、参与者与编号。")}
    </Empty>}
    {pages.cursor && <button className="work-more" disabled={pages.loading} onClick={pages.more}>{tr("加载更多作品")}</button>}
    {creating && <WorkEditor api={api} type={type}
      close={() => setCreating(false)} refresh={pages.reload}
      saved={(work) => { setCreating(false); navigate(detailPath(work.workId) + (type.id === "cd_album" ? "&import=1" : "")); }} />}
  </section>;
}
