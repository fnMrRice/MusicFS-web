import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { MusicCatalogApi, type MusicAlbum, type MusicTrack } from "../../api/music-catalog";
import { ScrapersApi, type AlbumMergeField } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { AlbumMergePreview, type AlbumMergeSnapshot } from "./AlbumMergePreview";
import { externalLink } from "./fields";
import { AlbumLookupError, albumLookupMessage } from "./album-search-errors";

export function AlbumRefresh({ album, applied, savingChanged }: {
  album: MusicAlbum; applied: () => void; savingChanged: (busy: boolean) => void;
}) {
  useLocale();
  const client = useServices().client;
  const api = useMemo(() => new ScrapersApi(client), [client]);
  const music = useMemo(() => new MusicCatalogApi(client), [client]);
  const [snapshot, setSnapshot] = useState<AlbumMergeSnapshot>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<{ key: string; fields: AlbumMergeField[] }>();
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setLoading(true); setSnapshot(undefined); setError(null); setConflict(false); setPending(undefined);
    async function read() {
      const current = await music.album(album.albumId, signal);
      if (!current.sourcePluginId || !externalLink(current.sourceUrl ?? undefined)) throw new AlbumLookupError(tr("请先关联平台专辑页面。"));
      const saved = await api.savedAlbum(current.albumId, signal);
      const details = await api.search(current.sourcePluginId, "albumDetails", { sourceUrl: current.sourceUrl! }, signal);
      if (details.length !== 1) throw new AlbumLookupError(tr("未找到关联页面对应的唯一专辑，请检查平台页面。"));
      const item = details[0]!;
      const candidates = await api.search(current.sourcePluginId, "albumTracks", {
        externalId: item.id, sourceUrl: item.sourceUrl || current.sourceUrl!,
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
  }, [album.albumId, api, music, retry]);
  async function merge(fields: AlbumMergeField[]) {
    if (!snapshot || lock.current || conflict) return;
    const selected = pending?.fields ?? fields;
    const key = pending?.key ?? crypto.randomUUID();
    lock.current = true; setSaving(true); savingChanged(true); setError(null);
    try {
      await api.mergeAlbumMetadata(snapshot.album.albumId, snapshot.album.revision, snapshot.album.sourcePluginId!,
        { albumDetails: snapshot.details.candidateToken, albumTracks: snapshot.tracks.candidateToken }, selected, key);
      if (mounted.current) applied();
    } catch (cause) {
      if (!mounted.current) return;
      const uncertain = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
      const expired = cause instanceof ApiError && (cause.status === 404 || cause.status === 410);
      setPending(uncertain ? { key, fields: selected } : undefined);
      setConflict(expired || cause instanceof ApiError && cause.status === 409);
      setError(expired ? tr("预览资料已失效，请重新读取后再合并。")
        : uncertain ? tr("保存结果待确认，请重试或关闭后刷新。") : errorMessage(cause));
    } finally {
      lock.current = false;
      if (mounted.current) { setSaving(false); savingChanged(false); }
    }
  }
  return <div className="album-refresh">
    {loading && <p className="muted" role="status">{tr("正在读取平台资料和完整曲目…")}</p>}
    <ErrorNotice error={error} />
    {!loading && (conflict || !snapshot) && <button type="button" disabled={saving} onClick={() => setRetry((value) => value + 1)}>{tr("重新读取")}</button>}
    {snapshot && <AlbumMergePreview key={snapshot.details.candidateToken} snapshot={snapshot} saving={saving || conflict}
      locked={!!pending} merge={(fields) => void merge(fields)} />}
  </div>;
}
