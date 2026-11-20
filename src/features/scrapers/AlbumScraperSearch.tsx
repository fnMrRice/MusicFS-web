import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, withRequestId } from "../../api/client";
import type { MusicAlbum } from "../../api/music-catalog";
import { ScrapersApi, type ScrapeCandidate, type Scraper, type ScraperQuery } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { AlbumMetadata } from "./AlbumMetadata";
import { AlbumRefresh } from "./AlbumRefresh";
import type { AlbumEdition, AlbumPreviews } from "./album-previews";
import { AlbumLookupError, albumLookupMessage, albumSaveMessage } from "./album-search-errors";
import { externalLink } from "./fields";

type CompleteAlbum = AlbumEdition & { source: Scraper };
type PlatformResults = { pluginId: string; items: ScrapeCandidate[]; error?: string };

export function AlbumScraperSearch({ album, previews, artist, hasSavedFields, applied, refresh, savingChanged }: {
  album: MusicAlbum; previews: AlbumPreviews; artist?: string; hasSavedFields: boolean; applied: () => void; refresh: () => void; savingChanged: (busy: boolean) => void;
}) {
  useLocale();
  const client = useServices().client;
  const music = useServices().musicCatalog;
  const api = useMemo(() => new ScrapersApi(client), [client]);
  const plugins = useResource("online-scrapers", (signal) => api.list(signal));
  const sources = plugins.data?.filter((source) => ["albumDetails", "albumTracks"].every((field) => source.fields.includes(field))) ?? [];
  const [sourceId, setSourceId] = useState<string>();
  const source = sources.find(item => item.available && item.pluginId === sourceId) ?? sources.find(item => item.available);
  const [title, setTitle] = useState(album.originalName || album.name);
  const [artistName, setArtistName] = useState(artist ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [country, setCountry] = useState("");
  const [results, setResults] = useState<PlatformResults>();
  const [pickedUrl, setPickedUrl] = useState("");
  const [preview, setPreview] = useState<CompleteAlbum>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [expired, setExpired] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lastQuery = useRef<ScraperQuery>({});
  const requestedAt = useRef(0);
  const mounted = useRef(true);
  const saveLock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const reset = () => { setResults(undefined); setPreview(undefined); setPickedUrl(""); setExpired(false); setError(null); };
  const disabled = busy || saving || !!pendingKey || conflict;
  function changeSource(id: string) {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    reset();
    setSourceUrl("");
    setSourceId(id);
  }
  async function load(action: (signal: AbortSignal) => Promise<void>, pageLookup = false) {
    if (controller.current || saveLock.current) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setError(null);
    try { await action(request.signal); }
    catch (cause) {
      if (!request.signal.aborted) {
        if (cause instanceof AlbumLookupError) setPreview(undefined);
        setError(albumLookupMessage(cause, pageLookup, sources));
      }
    }
    finally {
      if (controller.current === request) {
        controller.current = null;
        if (!request.signal.aborted) setBusy(false);
      }
    }
  }
  async function search() {
    if (!source || disabled) return;
    reset();
    const query: ScraperQuery = sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : { title: title.trim(), ...(artistName.trim() ? { artist: artistName.trim() } : {}) };
    if (country.trim()) query.country = country.trim().toUpperCase();
    lastQuery.current = query;
    requestedAt.current = Date.now();
    await load(async (signal) => {
      try {
        const items = await api.search(source.pluginId, "albumDetails", query, signal);
        if (!signal.aborted) setResults({ pluginId: source.pluginId, items });
      } catch (cause) {
        if (!signal.aborted) setResults({ pluginId: source.pluginId, items: [], error: albumLookupMessage(cause, !!query.sourceUrl, sources) });
      }
    }, !!query.sourceUrl);
  }
  const updateResult = useCallback((edition: AlbumEdition) => {
    setResults(current => current?.pluginId === edition.pluginId ? { ...current,
      items: current.items.map(item => item.id === edition.details.id ? edition.details : item) } : current);
  }, []);
  async function complete(source: Scraper, details: ScrapeCandidate, force = false) {
    if (!source?.available || disabled) return;
    const url = details.sourceUrl || lastQuery.current.sourceUrl;
    const query: ScraperQuery = { externalId: details.id, ...(url ? { sourceUrl: url } : {}),
      ...(lastQuery.current.country ? { country: lastQuery.current.country } : {}) };
    await load(async (signal) => {
      const edition = await previews.read(source.pluginId, query, signal,
        { refresh: force || expired, summary: { item: details, requestedAt: requestedAt.current } });
      if (signal.aborted) return;
      updateResult(edition);
      setPreview({ ...edition, source });
      setExpired(false);
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
      const tokenExpired = !!preview && cause instanceof ApiError && (cause.status === 404 || cause.status === 410);
      setExpired(tokenExpired);
      setConflict(cause instanceof ApiError && (cause.status === 409 || cause.status === 410 && !tokenExpired));
      setError(tokenExpired ? withRequestId("预览资料已失效，请刷新预览。", cause)
        : uncertain ? withRequestId("保存结果待确认，请重试或关闭后刷新。", cause)
        : albumSaveMessage(cause, preview ? "selection" : "links"));
    } finally {
      saveLock.current = false;
      if (mounted.current) { setSaving(false); savingChanged(false); }
    }
  }
  function saveLink() {
    if (!source || source.pluginId !== results?.pluginId || !pickedUrl) return;
    void save(key => music.updateAlbum(album, { name: album.name, publisher: album.publisher ?? "", releaseDate: album.releaseDate ?? "",
      sourceLinks: [...album.sourceLinks, { pluginId: source.pluginId, url: pickedUrl }] }, key));
  }
  return <div className="album-search">
    <ErrorNotice error={plugins.error} retry={plugins.reload} />
    {plugins.loading && <p role="status">{tr("正在加载…")}</p>}
    {plugins.data && !sources.length && <p>{tr("暂无支持完整专辑资料的刮削插件。")}</p>}
    {!!sources.length && !preview && <form onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <fieldset className="album-platforms" disabled={saving || !!pendingKey || conflict}><legend>{tr("资料来源")}</legend>{sources.map(item =>
        <label key={item.pluginId}><input type="radio" name="album-search-source" value={item.pluginId}
          checked={source?.pluginId === item.pluginId} disabled={!item.available} onChange={() => changeSource(item.pluginId)} />
          {item.name}{item.available ? "" : ` · ${tr("不可用")}`}</label>)}</fieldset>
      <fieldset disabled={disabled}>
        {source && <label>{tr("平台专辑页面（可选）")}<input type="url" value={sourceUrl} placeholder="https://…"
          onChange={(event) => { reset(); setSourceUrl(event.target.value); }} /></label>}
        <div className="album-editor-grid">
          <label>{tr("专辑名称")}<input value={title} maxLength={255} onChange={(event) => { reset(); setTitle(event.target.value); }} /></label>
          <label>{tr("歌手名称")}<input value={artistName} maxLength={255} onChange={(event) => { reset(); setArtistName(event.target.value); }} /></label>
        </div>
        <details><summary>{tr("更多查询条件")}</summary><label>{tr("查询地区")}<input value={country} maxLength={2}
          onChange={(event) => { reset(); setCountry(event.target.value); }} /></label></details>
      </fieldset>
      <button type="submit" className="primary" disabled={disabled || !source || !(sourceUrl.trim() || title.trim())}>{tr(busy ? "正在查询资料…" : "搜索")}</button>
    </form>}
    <ErrorNotice error={error} />
    {conflict && <button onClick={refresh}>{tr("刷新资料")}</button>}
    {!preview && results && source?.pluginId === results.pluginId && <section className="album-search-results" aria-label={source.name}>
      <h3>{source.name}</h3>
      {results.error ? <ErrorNotice error={results.error} /> : !results.items.length && <p>{tr("没有匹配的资料。")}</p>}
      {results.items.map(item => <article key={item.candidateToken}>
        <div><strong>{item.title}</strong>{item.artist && <span className="muted">{item.artist}</span>}</div>
        <div className="album-result-actions">
          {externalLink(item.sourceUrl) && !album.sourceLinks.some(link => link.pluginId === source.pluginId) &&
            <label><input type="checkbox" disabled={disabled} checked={pickedUrl === item.sourceUrl}
              onChange={event => setPickedUrl(event.target.checked ? item.sourceUrl! : "")} />{tr("关联此页面")}</label>}
          <button type="button" disabled={disabled} onClick={() => void complete(source, item)}>{tr("预览完整专辑")}</button>
        </div>
      </article>)}
    </section>}
    {!preview && pickedUrl && results?.pluginId === source?.pluginId && <button type="button" className="primary" disabled={busy || saving || conflict || album.sourceLinks.length >= 32}
      onClick={saveLink}>{tr(pendingKey ? "重试确认保存" : "保存选中平台链接")}</button>}
    {preview && hasSavedFields && <>
      <button type="button" disabled={saving} onClick={() => setPreview(undefined)}>{tr("返回搜索结果")}</button>
      <AlbumRefresh album={album} edition={preview} previews={previews} onRefresh={updateResult} applied={applied}
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
        <button type="button" disabled={disabled} onClick={() => void complete(preview.source, preview.details, true)}>{tr("刷新预览")}</button>
        <button type="button" className="primary" disabled={busy || saving || conflict || expired}
          onClick={() => void save(key => api.applyAlbumBundle(album.albumId, album.revision, preview.source.pluginId,
            { albumDetails: preview.details.candidateToken, albumTracks: preview.tracks.candidateToken }, key))}>{tr(pendingKey ? "重试确认保存" : "选用这张专辑")}</button>
      </div>
    </>}
  </div>;
}
