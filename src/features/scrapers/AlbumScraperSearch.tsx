import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import type { MusicAlbum } from "../../api/music-catalog";
import { ScrapersApi, type ScrapeCandidate, type Scraper, type ScraperQuery } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { AlbumMetadata } from "./AlbumMetadata";
import { AlbumRefresh, type AlbumEdition } from "./AlbumRefresh";
import { albumLookupMessage } from "./album-search-errors";
import { externalLink } from "./fields";

type CompleteAlbum = AlbumEdition & { source: Scraper };
type PlatformResults = { source: Scraper; items: ScrapeCandidate[]; error?: string };

export function AlbumScraperSearch({ album, artist, hasSavedFields, applied, refresh, savingChanged }: {
  album: MusicAlbum; artist?: string; hasSavedFields: boolean; applied: () => void; refresh: () => void; savingChanged: (busy: boolean) => void;
}) {
  useLocale();
  const client = useServices().client;
  const music = useServices().musicCatalog;
  const api = useMemo(() => new ScrapersApi(client), [client]);
  const plugins = useResource("online-scrapers", (signal) => api.list(signal));
  const sources = plugins.data?.filter((source) => ["albumDetails", "albumTracks"].every((field) => source.fields.includes(field))) ?? [];
  const [sourceIds, setSourceIds] = useState<string[]>();
  const defaults = sources.find(item => item.available)?.pluginId;
  const chosen = sourceIds ?? (defaults ? [defaults] : []);
  const selected = sources.filter(item => item.available && chosen.includes(item.pluginId));
  const [title, setTitle] = useState(album.originalName || album.name);
  const [artistName, setArtistName] = useState(artist ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [country, setCountry] = useState("");
  const [results, setResults] = useState<PlatformResults[] | null>(null);
  const [pickedLinks, setPickedLinks] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<CompleteAlbum>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lastQuery = useRef<ScraperQuery>({});
  const mounted = useRef(true);
  const saveLock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const reset = () => { setResults(null); setPreview(undefined); setPickedLinks({}); setError(null); };
  const disabled = busy || saving || !!pendingKey || conflict;
  async function load(action: (signal: AbortSignal) => Promise<void>, pageLookup = false) {
    if (controller.current || saveLock.current) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setError(null);
    try { await action(request.signal); }
    catch (cause) { if (!request.signal.aborted) setError(albumLookupMessage(cause, pageLookup)); }
    finally { controller.current = null; if (!request.signal.aborted) setBusy(false); }
  }
  async function search() {
    if (!selected.length || disabled) return;
    reset();
    const query: ScraperQuery = sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : { title: title.trim(), ...(artistName.trim() ? { artist: artistName.trim() } : {}) };
    if (country.trim()) query.country = country.trim().toUpperCase();
    lastQuery.current = query;
    await load(async (signal) => {
      const groups = await Promise.all(selected.map(async (source): Promise<PlatformResults> => {
        try { return { source, items: await api.search(source.pluginId, "albumDetails", query, signal) }; }
        catch (cause) { return { source, items: [], error: albumLookupMessage(cause, !!query.sourceUrl) }; }
      }));
      if (!signal.aborted) setResults(groups);
    }, !!query.sourceUrl);
  }
  async function complete(source: Scraper, details: ScrapeCandidate) {
    if (!source?.available || disabled) return;
    const url = details.sourceUrl || lastQuery.current.sourceUrl;
    const query: ScraperQuery = { externalId: details.id, ...(url ? { sourceUrl: url } : {}),
      ...(lastQuery.current.country ? { country: lastQuery.current.country } : {}) };
    await load(async (signal) => {
      const items = await api.search(source.pluginId, "albumTracks", query, signal);
      if (signal.aborted) return;
      const tracks = items.find((item) => item.id === details.id && item.tracks?.length);
      if (!tracks) { setError(tr("未能读取这张专辑的完整曲目，请重试或更换资料来源。")); return; }
      setPreview({ pluginId: source.pluginId, source, details, tracks });
    }, !!query.sourceUrl);
  }
  async function save(operation: (key: string) => Promise<unknown>) {
    if (saveLock.current || conflict) return;
    const key = pendingKey ?? crypto.randomUUID();
    saveLock.current = true; setSaving(true); savingChanged(true); setError(null);
    try {
      await operation(key);
      if (mounted.current) applied();
    } catch (cause) {
      if (!mounted.current) return;
      const uncertain = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
      setPendingKey(uncertain ? key : undefined);
      setConflict(cause instanceof ApiError && (cause.status === 409 || cause.status === 410));
      setError(uncertain ? tr("保存结果待确认，请重试或关闭后刷新。") : errorMessage(cause));
    } finally {
      saveLock.current = false;
      if (mounted.current) { setSaving(false); savingChanged(false); }
    }
  }
  const addedLinks = Object.entries(pickedLinks).map(([pluginId, url]) => ({ pluginId, url }));
  function saveLinks() {
    if (!addedLinks.length) return;
    void save(key => music.updateAlbum(album, { name: album.name, publisher: album.publisher ?? "", releaseDate: album.releaseDate ?? "",
      sourceLinks: [...album.sourceLinks, ...addedLinks] }, key));
  }
  return <div className="album-search">
    <ErrorNotice error={plugins.error} retry={plugins.reload} />
    {plugins.loading && <p role="status">{tr("正在加载…")}</p>}
    {plugins.data && !sources.length && <p>{tr("暂无支持完整专辑资料的刮削插件。")}</p>}
    {!!sources.length && !preview && <form onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <fieldset disabled={disabled}>
        <fieldset className="album-platforms"><legend>{tr("资料来源")}</legend>{sources.map(item =>
          <label key={item.pluginId}><input type="checkbox" checked={chosen.includes(item.pluginId)} disabled={!item.available}
            onChange={event => { reset(); setSourceUrl(""); setSourceIds(event.target.checked
              ? [...chosen, item.pluginId] : chosen.filter(id => id !== item.pluginId)); }} />
            {item.name}{item.available ? "" : ` · ${tr("不可用")}`}</label>)}</fieldset>
        {selected.length === 1 && <label>{tr("平台专辑页面（可选）")}<input type="url" value={sourceUrl} placeholder="https://…"
          onChange={(event) => { reset(); setSourceUrl(event.target.value); }} /></label>}
        <div className="album-editor-grid">
          <label>{tr("专辑名称")}<input value={title} maxLength={255} onChange={(event) => { reset(); setTitle(event.target.value); }} /></label>
          <label>{tr("歌手名称")}<input value={artistName} maxLength={255} onChange={(event) => { reset(); setArtistName(event.target.value); }} /></label>
        </div>
        <details><summary>{tr("更多查询条件")}</summary><label>{tr("查询地区")}<input value={country} maxLength={2}
          onChange={(event) => { reset(); setCountry(event.target.value); }} /></label></details>
      </fieldset>
      <button type="submit" className="primary" disabled={disabled || !selected.length || !(sourceUrl.trim() || title.trim())}>{tr(busy ? "正在查询资料…" : "搜索")}</button>
    </form>}
    <ErrorNotice error={error} />
    {conflict && <button onClick={refresh}>{tr("刷新资料")}</button>}
    {!preview && results?.map(group => <section key={group.source.pluginId} className="album-search-results" aria-label={group.source.name}>
      <h3>{group.source.name}</h3>
      {group.error ? <ErrorNotice error={group.error} /> : !group.items.length && <p>{tr("没有匹配的资料。")}</p>}
      {group.items.map(item => <article key={item.candidateToken}>
        <div><strong>{item.title}</strong>{item.artist && <span className="muted">{item.artist}</span>}</div>
        <div className="album-result-actions">
          {externalLink(item.sourceUrl) && !album.sourceLinks.some(link => link.pluginId === group.source.pluginId) &&
            <label><input type="checkbox" disabled={disabled} checked={pickedLinks[group.source.pluginId] === item.sourceUrl}
              onChange={event => {
                const next = { ...pickedLinks };
                if (event.target.checked) next[group.source.pluginId] = item.sourceUrl!;
                else delete next[group.source.pluginId];
                setPickedLinks(next);
              }} />{tr("关联此页面")}</label>}
          <button type="button" disabled={disabled} onClick={() => void complete(group.source, item)}>{tr("预览完整专辑")}</button>
        </div>
      </article>)}
    </section>)}
    {!preview && !!addedLinks.length && <button type="button" className="primary" disabled={busy || saving || conflict || addedLinks.length + album.sourceLinks.length > 32}
      onClick={saveLinks}>{tr(pendingKey ? "重试确认保存" : "保存选中平台链接")}</button>}
    {preview && hasSavedFields && <>
      <button type="button" disabled={saving} onClick={() => setPreview(undefined)}>{tr("返回搜索结果")}</button>
      <AlbumRefresh album={album} edition={preview} applied={applied}
        savingChanged={value => { setSaving(value); savingChanged(value); }} />
    </>}
    {preview && !hasSavedFields && <>
      <section className="album-metadata" aria-label={tr("完整专辑预览")}>
        <AlbumMetadata album={{ ...album, name: preview.details.album || preview.details.title, sourceLinks: preview.details.sourceUrl
          ? [{ pluginId: preview.source.pluginId, url: preview.details.sourceUrl }] : [] }} fields={[{ field: "albumDetails", pluginId: preview.source.pluginId, item: preview.details },
          { field: "albumTracks", pluginId: preview.source.pluginId, item: preview.tracks }]} />
      </section>
      <p className="muted">{tr("平台曲目表共 {0} 首。", { 0: preview.tracks.tracks!.length })}</p>
      <div className="album-search-actions">
        <button type="button" disabled={disabled} onClick={() => setPreview(undefined)}>{tr("返回搜索结果")}</button>
        <button type="button" className="primary" disabled={saving || conflict}
          onClick={() => void save(key => api.applyAlbumBundle(album.albumId, album.revision, preview.source.pluginId,
            { albumDetails: preview.details.candidateToken, albumTracks: preview.tracks.candidateToken }, key))}>{tr(pendingKey ? "重试确认保存" : "选用这张专辑")}</button>
      </div>
    </>}
  </div>;
}
