import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CategoriesApi, type Category, type CategoryKind } from "../../api/categories";
import type { Provider } from "../../api/types";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { Empty, ErrorNotice, Icon, IconButton, Sentinel } from "../../components/ui";
import { useSourceName } from "../../components/use-source-name";
import { tr, useLocale } from "../../i18n";
import { TrackTable } from "../TrackTable";
import { useCatalogPages } from "./use-catalog-pages";
import { MusicCategoryBrowser } from "./MusicCategoryBrowser";
import { AlbumViewSwitch } from "./AlbumCollection";
import "./categories.css";

export const categoryKinds: Record<string, CategoryKind> = { "歌手": "artist", "专辑": "album", "流派": "genre", "文件夹": "folder" };
const categoryLabels = { artist: "歌手", album: "专辑", genre: "流派", folder: "文件夹" };
const unknownLabels = { artist: "未知歌手", album: "未知专辑", genre: "未知流派", folder: "文件夹" };
function rootName(item: Category, providers: Provider[]): string {
  return providers.find((provider) => provider.id === item.providerInstanceId)?.roots?.find((root) => root.id === item.rootId)?.name || tr("音乐目录");
}
function categoryName(item: Category, providers: Provider[]): string {
  if (item.unknown) return tr(unknownLabels[item.kind]);
  return item.kind === "folder" && item.parentId === null ? rootName(item, providers) : item.name;
}
type Navigate = (id: string | null) => void;

export function CategoryBrowser({ kind, provider, providers, providerError, reloadProviders }: {
  kind: CategoryKind; provider: string; providers: Provider[]; providerError: string | null; reloadProviders: () => void;
}) {
  useLocale();
  const s = useServices();
  const api = useMemo(() => new CategoriesApi(s.client), [s]);
  const sourceName = useSourceName();
  const [params, setParams] = useSearchParams();
  const selected = params.get("categoryId") || "";
  const unknown = kind !== "folder" && params.get("unknownCategory") === "1";
  const inCategory = !!selected || unknown;
  const unscrapedOnly = kind === "album" && params.get("unscrapedOnly") === "true";
  const query = params.get("categoryQuery") || "";
  const [draft, setDraft] = useState(query);
  const [refresh, setRefresh] = useState(0);
  const scope = `${kind}:${provider}:${selected}:${query}:${refresh}:${unscrapedOnly}`;
  useEffect(() => { setDraft(query); }, [query, selected, kind, provider]);
  useEffect(() => { document.querySelector("#page-scroll")?.scrollTo({ top: 0 }); }, [scope]);
  const navigate: Navigate = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set("categoryId", id); else next.delete("categoryId");
    if (id === "") next.set("unknownCategory", "1"); else next.delete("unknownCategory");
    next.delete("categoryQuery");
    setParams(next);
  };
  return <>
    <form className="filters" onSubmit={(event) => {
      event.preventDefault();
      const next = new URLSearchParams(params);
      if (draft.trim()) next.set("categoryQuery", draft.trim()); else next.delete("categoryQuery");
      setParams(next);
    }}>
      <select aria-label={tr("来源")} value={provider} onChange={(event) => {
        const next = new URLSearchParams(params);
        next.set("source", event.target.value); next.delete("categoryId"); next.delete("unknownCategory"); next.delete("categoryQuery"); setParams(next);
      }}>
        <option value="all">{tr("全部来源")}</option>
        {providers.map((item) => <option key={item.id} value={item.id}>{sourceName(item)}</option>)}
      </select>
      {kind === "album" && !inCategory && <>
        <label className="check-label"><input type="checkbox" checked={unscrapedOnly} onChange={event => {
          const next = new URLSearchParams(params);
          if (event.target.checked) next.set("unscrapedOnly", "true"); else next.delete("unscrapedOnly");
          setParams(next);
        }} /> {tr("仅显示未刮削专辑")}</label>
        <AlbumViewSwitch />
      </>}
      <div className="filter-end">
        <input value={draft} maxLength={256} onChange={(event) => setDraft(event.target.value)}
          aria-label={tr(inCategory ? "搜索当前列表" : "搜索分类")} placeholder={tr(inCategory ? "搜索当前列表" : "搜索分类")} />
        <button type="submit">{tr("搜索")}</button>
        {query && <button type="button" onClick={() => { const next = new URLSearchParams(params); next.delete("categoryQuery"); setParams(next); }}>{tr("清空")}</button>}
        <IconButton icon="refresh" label={tr("刷新列表")} onClick={() => { reloadProviders(); setRefresh((value) => value + 1); }} />
      </div>
    </form>
    <ErrorNotice error={providerError} retry={reloadProviders} />
    {kind !== "folder" ? <MusicCategoryBrowser key={`${scope}:${unknown}`} kind={kind} provider={provider} providers={providers}
      id={selected} unknown={unknown} query={query} unscrapedOnly={unscrapedOnly} navigate={navigate} /> :
      selected ? <CategoryDetail key={`${kind}:${provider}:${selected}`} api={api} kind={kind} provider={provider} id={selected}
      query={query} refresh={refresh} providers={providers} navigate={navigate} /> :
      <CategoryCollection key={scope} api={api} kind={kind} provider={provider} query={query} providers={providers} navigate={navigate} />}
  </>;
}

function CategoryCards({ items, providers, navigate }: { items: Category[]; providers: Provider[]; navigate: Navigate }) {
  const sourceName = useSourceName();
  return <div className="category-cards">
    {items.map((item) => <button type="button" className="category-card" key={item.categoryId} onClick={() => navigate(item.categoryId)}>
      <span className="category-icon"><Icon name={item.kind === "artist" ? "user" : item.kind === "folder" ? "folder" : item.kind === "album" ? "album" : "music"} size={25} /></span>
      <span className="category-card-text"><strong>{categoryName(item, providers)}</strong>
        <small>{tr("{0} 首", { 0: item.trackCount })}{item.providerInstanceId && ` · ${sourceName(item.providerInstanceId)}`}</small></span>
      <Icon name="chevron" size={16} />
    </button>)}
  </div>;
}
function CategoryCollection({ api, kind, provider, query = "", parentId, providers, navigate }: {
  api: CategoriesApi; kind: CategoryKind; provider: string; query?: string; parentId?: string; providers: Provider[]; navigate: Navigate;
}) {
  const pages = useCatalogPages(`${kind}:${provider}:${parentId || ""}:${query}`, api,
    (cursor, signal) => api.categories({ categoryKind: kind, providerInstanceId: provider, parentId, q: query }, cursor, signal),
    (item) => item.categoryId);
  return <>
    <CategoryCards items={pages.items} providers={providers} navigate={navigate} />
    <ErrorNotice error={pages.error} retry={pages.retry} />
    {pages.loading && <p className="loading" role="status">{tr("正在加载…")}</p>}
    {!pages.loading && !pages.error && !pages.items.length && !parentId && <Empty title={tr("暂无可浏览的分类")}>
      {tr(kind === "folder" ? "没有可浏览的音乐文件夹。" : "当前来源和搜索条件下没有分类。")}
    </Empty>}
    <Sentinel active={!!pages.cursor && !pages.loading && !pages.error} load={pages.more} />
  </>;
}

function CategoryDetail({ api, kind, provider, id, query, refresh, providers, navigate }: {
  api: CategoriesApi; kind: CategoryKind; provider: string; id: string; query: string; refresh: number; providers: Provider[]; navigate: Navigate;
}) {
  const scope = `${kind}:${provider}:${id}:${query}:${refresh}`;
  const metadata = useResource(`${kind}:${provider}:${id}:${refresh}`, async (signal) => {
    const page = await api.categories({ categoryKind: kind, providerInstanceId: provider, categoryId: id }, null, signal);
    void api.release(page.queryId).catch(() => {});
    return page.items.find((item) => item.categoryId === id) ?? null;
  });
  const pages = useCatalogPages(scope, api,
    (cursor, signal) => api.tracks({ categoryKind: kind, categoryId: id, providerInstanceId: provider, q: query }, cursor, signal),
    (item) => item.sourceTrackId);
  const selected = metadata.data;
  const breadcrumbs = selected ? [...selected.breadcrumbs] : [];
  if (selected && !breadcrumbs.some((item) => item.categoryId === id)) breadcrumbs.push({ categoryId: id, name: selected.name });
  return <>
    <nav className="category-breadcrumbs" aria-label={tr("分类路径")}>
      <button type="button" onClick={() => navigate(null)}>{tr(categoryLabels[kind])}</button>
      {breadcrumbs.map((item, index) => <span key={item.categoryId}>
        <Icon name="chevron" size={14} />
        <button type="button" aria-current={item.categoryId === id ? "page" : undefined} onClick={() => navigate(item.categoryId)}>
          {item.categoryId === id && selected ? categoryName(selected, providers) : kind === "folder" && index === 0 && selected ? rootName(selected, providers) : item.name}
        </button>
      </span>)}
    </nav>
    <ErrorNotice error={metadata.error} retry={metadata.reload} />
    {metadata.loading && <p className="loading">{tr("正在加载…")}</p>}
    {selected && <div className="category-heading"><h2>{categoryName(selected, providers)}</h2>
      {pages.total !== null && <span className="muted">{tr("{0} 首", { 0: pages.total })}</span>}</div>}
    {kind === "folder" && selected && <section aria-label={tr("子目录")}>
      <CategoryCollection key={`${id}:${refresh}`} api={api} kind={kind} provider={provider} parentId={id} providers={providers} navigate={navigate} />
    </section>}
    {pages.items.length > 0 && <TrackTable tracks={pages.items} providers={providers} queryKey={scope} libraryProvider={provider}
      complete={!pages.cursor && !pages.loading && !pages.error}
      pagination={{ loading: pages.loading, hasMore: !!pages.cursor, error: pages.error, more: pages.more }} />}
    <ErrorNotice error={pages.error} retry={pages.retry} />
    {pages.loading && <p className="loading" role="status">{tr("正在加载…")}</p>}
    {!pages.loading && !pages.error && !pages.items.length && <Empty title={tr("没有找到相关曲目")} />}
    <Sentinel active={!!pages.cursor && !pages.loading && !pages.error} load={pages.more} />
  </>;
}
