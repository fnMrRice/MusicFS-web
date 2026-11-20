import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, withRequestId } from "../../api/client";
import { MusicCatalogApi, type MusicAlbum, type MusicTrack } from "../../api/music-catalog";
import { ScrapersApi, type AlbumMergeField, type ScrapeCandidate } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { AlbumMergePreview, type AlbumMergeSnapshot } from "./AlbumMergePreview";
import { externalLink } from "./fields";
import { AlbumLookupError, albumLookupMessage, albumSaveMessage } from "./album-search-errors";

export interface AlbumEdition { pluginId: string; details: ScrapeCandidate; tracks: ScrapeCandidate }

export function AlbumRefresh({ album, edition, applied, savingChanged }: {
  album: MusicAlbum; edition?: AlbumEdition; applied: () => void; savingChanged: (busy: boolean) => void;
}) {
  useLocale();
  const client = useServices().client;
  const api = useMemo(() => new ScrapersApi(client), [client]);
  const music = useMemo(() => new MusicCatalogApi(client), [client]);
  const plugins = useResource("online-scrapers", signal => api.list(signal));
  const links = album.sourceLinks.filter(link => !!externalLink(link.url));
  const [sourceId, setSourceId] = useState(links.length === 1 ? links[0].pluginId : "");
  const [reading, setReading] = useState(edition?.pluginId ?? "");
  const [snapshot, setSnapshot] = useState<AlbumMergeSnapshot>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<{ key: string; fields: AlbumMergeField[] }>();
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!reading) return;
    const controller = new AbortController();
    const signal = controller.signal;
    setLoading(true); setSnapshot(undefined); setError(null); setConflict(false); setPending(undefined);
    async function read() {
      const current = await music.album(album.albumId, signal);
      const link = current.sourceLinks.find(item => item.pluginId === reading);
      if (!edition && (!link || !externalLink(link.url))) throw new AlbumLookupError(tr("请先关联平台专辑页面。"));
      const saved = await api.savedAlbum(current.albumId, signal);
      const prior = retry === 0 ? edition : undefined;
      const lookup = edition ? { externalId: edition.details.id, sourceUrl: edition.details.sourceUrl } : { sourceUrl: link!.url };
      const details = prior ? [prior.details] : await api.search(reading, "albumDetails", lookup, signal);
      if (details.length !== 1 || edition && details[0]?.id !== edition.details.id) {
        throw new AlbumLookupError(tr("未找到关联页面对应的唯一专辑，请检查平台页面。"));
      }
      const item = details[0]!;
      const candidates = prior ? [prior.tracks] : await api.search(reading, "albumTracks", {
        externalId: item.id, sourceUrl: item.sourceUrl || lookup.sourceUrl,
      }, signal);
      const tracks = candidates.find((candidate) => candidate.id === item.id && candidate.tracks?.length);
      if (!tracks) throw new AlbumLookupError(tr("未能读取这张专辑的完整曲目，请重试或更换资料来源。"));
      const currentTracks: MusicTrack[] = [];
      const cursors = new Set<string>();
      let after: string | null = null, revision: string | undefined;
      do {
        const page = await music.tracks({ albumId: current.albumId }, after, signal);
        if (revision && revision !== page.libraryRevision) throw new ApiError("CURSOR_EXPIRED", "Album changed during comparison", 409);
        revision = page.libraryRevision;
        currentTracks.push(...page.items);
        after = page.nextAfter;
        if (after && cursors.has(after)) throw new ApiError("INVALID_RESPONSE", "Album pagination did not advance");
        if (after) cursors.add(after);
      } while (after);
      if (!signal.aborted) setSnapshot({ album: current, saved, currentTracks, details: item, tracks });
    }
    void read().catch((cause) => {
      if (!signal.aborted) setError(albumLookupMessage(cause, true));
    }).finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [album.albumId, api, music, retry, reading, edition]);
  async function merge(fields: AlbumMergeField[]) {
    if (!snapshot || lock.current || conflict) return;
    const selected = pending?.fields ?? fields;
    const key = pending?.key ?? crypto.randomUUID();
    lock.current = true; setSaving(true); savingChanged(true); setError(null);
    try {
      await api.mergeAlbumMetadata(snapshot.album.albumId, snapshot.album.revision, reading,
        { albumDetails: snapshot.details.candidateToken, albumTracks: snapshot.tracks.candidateToken }, selected, key);
      if (mounted.current) applied();
    } catch (cause) {
      if (!mounted.current) return;
      const uncertain = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
      const expired = cause instanceof ApiError && (cause.status === 404 || cause.status === 410);
      setPending(uncertain ? { key, fields: selected } : undefined);
      setConflict(expired || cause instanceof ApiError && cause.status === 409);
      setError(expired ? withRequestId("预览资料已失效，请重新读取后再合并。", cause)
        : uncertain ? withRequestId("保存结果待确认，请重试或关闭后刷新。", cause) : albumSaveMessage(cause, "merge"));
    } finally {
      lock.current = false;
      if (mounted.current) { setSaving(false); savingChanged(false); }
    }
  }
  return <div className="album-refresh">
    {edition && <p><strong>{plugins.data?.find(plugin => plugin.pluginId === reading)?.name ?? edition.details.title}</strong></p>}
    {!edition && <label>{tr("资料平台")}<select aria-label={tr("资料平台")} value={sourceId} disabled={saving || !!pending}
      onChange={event => { setSourceId(event.target.value); setReading(""); setLoading(false); setSnapshot(undefined); setError(null); }}>
      <option value="">{tr("选择资料平台")}</option>
      {links.map(link => <option key={link.pluginId} value={link.pluginId}>
        {plugins.data?.find(plugin => plugin.pluginId === link.pluginId)?.name ?? new URL(link.url).hostname}
      </option>)}
    </select></label>}
    {!reading && <button type="button" disabled={!sourceId} onClick={() => setReading(sourceId)}>{tr("读取平台资料")}</button>}
    {loading && <p className="muted" role="status">{tr("正在读取平台资料和完整曲目…")}</p>}
    <ErrorNotice error={error} />
    {reading && !loading && (conflict || !snapshot) && <button type="button" disabled={saving} onClick={() => setRetry((value) => value + 1)}>{tr("重新读取")}</button>}
    {snapshot && <AlbumMergePreview key={snapshot.details.candidateToken} snapshot={snapshot} saving={saving || conflict}
      locked={!!pending} merge={(fields) => void merge(fields)} />}
  </div>;
}
