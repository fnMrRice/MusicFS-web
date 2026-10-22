import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { WorksApi, type WorkFilters } from "../../api/works";
import { useServices } from "../../app/services";
import { usePages, useResource } from "../../components/query";
import { Empty, ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { WorkEditor } from "./WorkEditor";
import { workCategoryName } from "./navigation";
import "./works.css";

export function Works() {
  useLocale();
  const services = useServices();
  const api = useMemo(() => new WorksApi(services.client), [services]);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const kind = params.get("packageKind");
  const invalidKind = kind !== null && kind !== "directory" && kind !== "cd_dump";
  const filters: WorkFilters = { contentType: params.get("contentType") || "", q: params.get("q") || "", tag: params.get("tag") || "",
    packageKind: kind === "directory" || kind === "cd_dump" ? kind : undefined };
  const [queryText, setQueryText] = useState(filters.q ?? "");
  const [tagText, setTagText] = useState(filters.tag ?? "");
  useEffect(() => { setQueryText(filters.q ?? ""); setTagText(filters.tag ?? ""); }, [filters.q, filters.tag]);
  const key = JSON.stringify([filters, kind]);
  const types = useResource("work-content-types", (signal) => api.types(signal));
  const pages = usePages(`works:${key}`, async (after, signal) => {
    if (invalidKind) return { items: [], cursor: null };
    const result = await api.list(filters, after, signal);
    return { items: result.items, cursor: result.nextAfter };
  }, (work) => work.workId);
  const [creating, setCreating] = useState(false);
  const availableTypes = types.data ?? [];
  const selectedType = availableTypes.find((type) => type.id === filters.contentType);
  const cdDump = filters.packageKind === "cd_dump";
  const title = cdDump ? tr("CD 抓轨") : selectedType ? workCategoryName(selectedType) : filters.contentType || tr("全部作品");
  const description = cdDump ? tr("按作品整理 CD 抓轨，保留音轨、CUE、抓轨日志和扫描图。") :
    selectedType?.description || tr("按内容类型浏览收藏，整理每一部作品的资料与参与者。");
  const sectionQuery = new URLSearchParams();
  if (filters.contentType) sectionQuery.set("contentType", filters.contentType);
  if (filters.packageKind) sectionQuery.set("packageKind", filters.packageKind);
  const detailPath = (id: string) => `/works/${encodeURIComponent(id)}${sectionQuery.size ? `?${sectionQuery}` : ""}`;
  const filtered = Object.values(filters).some(Boolean);
  return <section className="works-page" aria-label={tr("作品库")}>
    <div className="work-heading">
      <div><h2>{title}</h2><p className="muted">{description}</p></div>
      <button className="primary" disabled={!availableTypes.length || invalidKind} onClick={() => setCreating(true)}>{tr("新建作品")}</button>
    </div>
    <form className="work-filters" onSubmit={(event) => {
      event.preventDefault();
      const next = new URLSearchParams();
      if (filters.contentType) next.set("contentType", filters.contentType);
      if (kind !== null) next.set("packageKind", kind);
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
    <ErrorNotice error={invalidKind ? tr("副本类型无效，请从左侧重新选择分类。") : null} />
    <p className="notice">{tr(cdDump ? "导入时选择“CD 抓轨”副本类型，即可在这里查看。新建作品后会继续导入抓轨目录。" :
      "进入作品详情可以导入本地副本，按目录播放音轨并查看附件。")}</p>
    <div className="work-cards">
      {pages.items.map((work) => <Link className="work-card" key={work.workId} to={detailPath(work.workId)}>
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
    {!invalidKind && !pages.loading && !pages.error && !pages.items.length && <Empty
      title={tr(cdDump && !filters.q && !filters.tag ? "还没有 CD 抓轨" : filtered ? "还没有符合条件的作品" : "作品库还没有作品")} icon="album">
      {tr(cdDump ? "可以在已有作品中导入抓轨副本，或先新建作品资料。" : filtered ? "可以调整筛选条件，或新建一份作品资料。" : "新建第一份作品资料，记录标题、参与者与编号。")}
    </Empty>}
    {pages.cursor && <button className="work-more" disabled={pages.loading} onClick={pages.more}>{tr("加载更多作品")}</button>}
    {creating && <WorkEditor api={api} types={availableTypes}
      initialType={selectedType?.id ?? (cdDump && availableTypes.some((type) => type.id === "music") ? "music" : undefined)}
      close={() => setCreating(false)} refresh={pages.reload}
      saved={(work) => { setCreating(false); navigate(cdDump ? `/works/${encodeURIComponent(work.workId)}?packageKind=cd_dump&import=1` : `/works/${encodeURIComponent(work.workId)}?contentType=${encodeURIComponent(work.contentType)}`); }} />}
  </section>;
}
