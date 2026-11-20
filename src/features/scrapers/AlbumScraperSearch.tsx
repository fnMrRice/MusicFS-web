import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import type { MusicAlbum } from "../../api/music-catalog";
import { ScrapersApi, type ScrapeCandidate, type ScraperQuery } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { AlbumMetadata } from "./AlbumMetadata";

type CompleteAlbum = { details: ScrapeCandidate; tracks: ScrapeCandidate };

export function AlbumScraperSearch({ album, artist, applied, refresh, savingChanged }: {
  album: MusicAlbum; artist?: string; applied: () => void; refresh: () => void; savingChanged: (busy: boolean) => void;
}) {
  useLocale();
  const client = useServices().client;
  const api = useMemo(() => new ScrapersApi(client), [client]);
  const plugins = useResource("online-scrapers", (signal) => api.list(signal));
  const sources = plugins.data?.filter((source) => ["albumDetails", "albumTracks"].every((field) => source.fields.includes(field))) ?? [];
  const [sourceId, setSourceId] = useState("");
  const source = sources.find((item) => item.pluginId === sourceId) ?? sources.find((item) => item.available) ?? sources[0];
  const [title, setTitle] = useState(album.originalName || album.name);
  const [artistName, setArtistName] = useState(artist ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [country, setCountry] = useState("");
  const [results, setResults] = useState<ScrapeCandidate[] | null>(null);
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
  const reset = () => { setResults(null); setPreview(undefined); setError(null); };
  const disabled = busy || saving || !!pendingKey || conflict;
  async function load(action: (signal: AbortSignal) => Promise<void>) {
    if (controller.current || saveLock.current) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setError(null);
    try { await action(request.signal); }
    catch (cause) { if (!request.signal.aborted) setError(errorMessage(cause)); }
    finally { controller.current = null; if (!request.signal.aborted) setBusy(false); }
  }
  async function search() {
    if (!source?.available || disabled) return;
    reset();
    const query: ScraperQuery = sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : { title: title.trim(), ...(artistName.trim() ? { artist: artistName.trim() } : {}) };
    if (country.trim()) query.country = country.trim().toUpperCase();
    lastQuery.current = query;
    await load(async (signal) => {
      const items = await api.search(source.pluginId, "albumDetails", query, signal);
      if (!signal.aborted) setResults(items);
    });
  }
  async function complete(details: ScrapeCandidate) {
    if (!source?.available || disabled) return;
    const url = details.sourceUrl || lastQuery.current.sourceUrl;
    const query: ScraperQuery = { externalId: details.id, ...(url ? { sourceUrl: url } : {}),
      ...(lastQuery.current.country ? { country: lastQuery.current.country } : {}) };
    await load(async (signal) => {
      const items = await api.search(source.pluginId, "albumTracks", query, signal);
      if (signal.aborted) return;
      const tracks = items.find((item) => item.id === details.id && item.tracks?.length);
      if (!tracks) { setError(tr("未能读取这张专辑的完整曲目，请重试或更换资料来源。")); return; }
      setPreview({ details, tracks });
    });
  }
  async function save() {
    if (!source || !preview || saveLock.current || conflict) return;
    const key = pendingKey ?? crypto.randomUUID();
    saveLock.current = true; setSaving(true); savingChanged(true); setError(null);
    try {
      await api.applyAlbumBundle(album.albumId, album.revision, source.pluginId,
        { albumDetails: preview.details.candidateToken, albumTracks: preview.tracks.candidateToken }, key);
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
  return <div className="album-search">
    <ErrorNotice error={plugins.error} retry={plugins.reload} />
    {plugins.loading && <p role="status">{tr("正在加载…")}</p>}
    {plugins.data && !source && <p>{tr("暂无支持完整专辑资料的刮削插件。")}</p>}
    {source && !preview && <form onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <fieldset disabled={disabled}>
        <label>{tr("资料来源")}<select value={source.pluginId} onChange={(event) => { reset(); setSourceId(event.target.value); }}>
          {sources.map((item) => <option key={item.pluginId} value={item.pluginId}>{item.name}{item.available ? "" : ` · ${tr("不可用")}`}</option>)}
        </select></label>
        <label>{tr("平台专辑页面（可选）")}<input type="url" value={sourceUrl} placeholder="https://…"
          onChange={(event) => { reset(); setSourceUrl(event.target.value); }} /></label>
        <div className="album-editor-grid">
          <label>{tr("专辑名称")}<input value={title} maxLength={255} onChange={(event) => { reset(); setTitle(event.target.value); }} /></label>
          <label>{tr("歌手名称")}<input value={artistName} maxLength={255} onChange={(event) => { reset(); setArtistName(event.target.value); }} /></label>
        </div>
        <details><summary>{tr("更多查询条件")}</summary><label>{tr("查询地区")}<input value={country} maxLength={2}
          onChange={(event) => { reset(); setCountry(event.target.value); }} /></label></details>
        {!source.available && <p className="muted">{tr("此来源当前不可用，请检查服务端配置。")}</p>}
      </fieldset>
      <button type="submit" className="primary" disabled={disabled || !source.available || !(sourceUrl.trim() || title.trim())}>{tr(busy ? "正在查询资料…" : "搜索")}</button>
    </form>}
    <ErrorNotice error={error} />
    {conflict && <button onClick={refresh}>{tr("刷新资料")}</button>}
    {!preview && results?.length === 0 && <p>{tr("没有匹配的资料。")}</p>}
    {!preview && !!results?.length && <div className="album-search-results">{results.map((item) => <article key={item.candidateToken}>
      <div><strong>{item.title}</strong>{item.artist && <span className="muted">{item.artist}</span>}</div>
      <button type="button" disabled={disabled} onClick={() => void complete(item)}>{tr("预览完整专辑")}</button>
    </article>)}</div>}
    {preview && <>
      <section className="album-metadata" aria-label={tr("完整专辑预览")}>
        <AlbumMetadata album={album} fields={[{ field: "albumDetails", pluginId: source!.pluginId, item: preview.details },
          { field: "albumTracks", pluginId: source!.pluginId, item: preview.tracks }]} />
      </section>
      <p className="muted">{tr("将补齐 {0} 首曲目资料，已有音源保留。", { 0: preview.tracks.tracks!.length })}</p>
      <div className="album-search-actions">
        <button type="button" disabled={disabled} onClick={() => setPreview(undefined)}>{tr("返回搜索结果")}</button>
        <button type="button" className="primary" disabled={saving || conflict} onClick={() => void save()}>{tr(pendingKey ? "重试确认保存" : "选用这张专辑")}</button>
      </div>
    </>}
  </div>;
}
