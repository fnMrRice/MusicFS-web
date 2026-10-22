import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { WorksApi } from "../../api/works";
import { useServices } from "../../app/services";
import { usePages, useResource } from "../../components/query";
import { Empty, ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { WorkEditor } from "./WorkEditor";
import "./works.css";

export function Works() {
  useLocale();
  const services = useServices();
  const api = useMemo(() => new WorksApi(services.client), [services]);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = { contentType: params.get("contentType") || "", q: params.get("q") || "", tag: params.get("tag") || "" };
  const [queryText, setQueryText] = useState(filters.q);
  const [tagText, setTagText] = useState(filters.tag);
  useEffect(() => { setQueryText(filters.q); setTagText(filters.tag); }, [filters.q, filters.tag]);
  const key = JSON.stringify(filters);
  const types = useResource("work-content-types", (signal) => api.types(signal));
  const pages = usePages(`works:${key}`, async (after, signal) => {
    const result = await api.list(filters, after, signal);
    return { items: result.items, cursor: result.nextAfter };
  }, (work) => work.workId);
  const [creating, setCreating] = useState(false);
  const availableTypes = types.data ?? [];
  const filtered = Object.values(filters).some(Boolean);
  return <section className="works-page" aria-label={tr("作品库")}>
    <div className="work-heading">
      <div><h2>{tr("我的作品")}</h2><p className="muted">{tr("按内容类型浏览收藏，整理每一部作品的资料与参与者。")}</p></div>
      <button className="primary" disabled={!availableTypes.length} onClick={() => setCreating(true)}>{tr("新建作品")}</button>
    </div>
    <div className="work-type-tabs" role="group" aria-label={tr("作品分类")}>
      {[{ id: "", name: tr("全部作品") }, ...availableTypes,
        ...(filters.contentType && !availableTypes.some((type) => type.id === filters.contentType) ?
          [{ id: filters.contentType, name: filters.contentType }] : [])].map((type) =>
        <button key={type.id} aria-pressed={filters.contentType === type.id}
          className={filters.contentType === type.id ? "active" : ""} onClick={() => {
            const next = new URLSearchParams(params);
            if (type.id) next.set("contentType", type.id); else next.delete("contentType");
            setParams(next);
          }}>{type.name}</button>)}
    </div>
    <form className="work-filters" onSubmit={(event) => {
      event.preventDefault();
      const next = new URLSearchParams();
      if (filters.contentType) next.set("contentType", filters.contentType);
      if (queryText.trim()) next.set("q", queryText.trim());
      if (tagText.trim()) next.set("tag", tagText.trim());
      setParams(next);
    }}>
      <label>{tr("作品关键词")}<input name="q" value={queryText} onChange={(event) => setQueryText(event.target.value)} maxLength={256} /></label>
      <label>{tr("标签筛选")}<input name="tag" value={tagText} onChange={(event) => setTagText(event.target.value)} maxLength={64} /></label>
      <button>{tr("筛选")}</button>
      <button type="button" onClick={() => { types.reload(); pages.reload(); }}>{tr("刷新列表")}</button>
    </form>
    <ErrorNotice error={types.error} retry={types.reload} />
    <p className="notice">{tr("当前支持手工管理作品资料，目录导入和音轨关联尚未接入。")}</p>
    <div className="work-cards">
      {pages.items.map((work) => <Link className="work-card" key={work.workId} to={`/works/${encodeURIComponent(work.workId)}`}>
        <span className="work-type">{availableTypes.find((type) => type.id === work.contentType)?.name ?? work.contentType}</span>
        <h3>{work.title}</h3>
        {work.credits.length > 0 && <div className="work-card-credits">{work.credits.slice(0, 3).map((credit, index) =>
          <p className="muted" key={index}><span>{availableTypes.find((type) => type.id === work.contentType)
            ?.creditRoles.find((role) => role.id === credit.role)?.name ?? credit.role}</span>{credit.name}</p>)}
        </div>}
        {work.description && <p className="work-excerpt">{work.description}</p>}
        {!!work.tags.length && <div className="work-tags">{work.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      </Link>)}
    </div>
    <ErrorNotice error={pages.error} retry={pages.retry} />
    {pages.loading && <p role="status">{tr("正在加载…")}</p>}
    {!pages.loading && !pages.error && !pages.items.length && <Empty
      title={tr(filtered ? "还没有符合条件的作品" : "作品库还没有作品")} icon="album">
      {tr(filtered ? "可以调整筛选条件，或新建一份作品资料。" : "新建第一份作品资料，记录标题、参与者与编号。")}
    </Empty>}
    {pages.cursor && <button className="work-more" disabled={pages.loading} onClick={pages.more}>{tr("加载更多作品")}</button>}
    {creating && <WorkEditor api={api} types={availableTypes}
      initialType={availableTypes.some((type) => type.id === filters.contentType) ? filters.contentType : undefined}
      close={() => setCreating(false)} refresh={pages.reload}
      saved={(work) => { setCreating(false); navigate(`/works/${encodeURIComponent(work.workId)}`); }} />}
  </section>;
}
