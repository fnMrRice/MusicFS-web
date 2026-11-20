import { useMemo, useState } from "react";
import type { MusicAlbum } from "../../api/music-catalog";
import { ScrapersApi } from "../../api/scrapers";
import { useServices, useStore } from "../../app/services";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { AlbumMetadata } from "./AlbumMetadata";
import { AlbumScraperSearch } from "./AlbumScraperSearch";
import { AlbumEditor } from "./AlbumEditor";
import { AlbumScrapeClear } from "./AlbumScrapeClear";
import { AlbumRefresh } from "./AlbumRefresh";
import { AutoAlbumScrape } from "./AutoAlbumScrape";
import { AlbumPreviews } from "./album-previews";
import { externalLink } from "./fields";
import "./scrapers.css";

export function AlbumScraping({ album, provider, artist, detailsId, detailsOpen, applied, refresh }: {
  album: MusicAlbum; provider: string; artist?: string; detailsId: string; detailsOpen: boolean;
  applied: () => void; refresh: () => void;
}) {
  useLocale();
  const services = useServices();
  const client = services.client;
  const auth = useStore(services.auth);
  const api = useMemo(() => new ScrapersApi(client), [client]);
  const previews = useMemo(() => new AlbumPreviews(api), [api, auth.session, auth.ready?.instanceId, album.albumId]);
  const saved = useResource(`album-scraped:${album.albumId}:${album.revision}`, (signal) => api.savedAlbum(album.albumId, signal));
  const [saving, setSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clearTarget, setClearTarget] = useState<MusicAlbum | null>(null);
  const online = saved.data?.find((entry) => entry.field === "albumDetails")?.item;
  const linked = album.sourceLinks.some(link => !!externalLink(link.url));
  return <>
    {detailsOpen && <section id={detailsId} className="album-metadata" aria-label={tr("专辑详情")}>
      <div className="album-metadata-actions">
        <button type="button" disabled={saved.loading || !!saved.data?.length} onClick={() => setAutoOpen(true)}
          title={saved.data?.length ? tr("这张专辑已有刮削资料。") : undefined}>{tr("自动刮削")}</button>
        <button type="button" onClick={() => setSearchOpen(true)}>{tr("搜索")}</button>
        <button type="button" disabled={saved.loading || !linked} onClick={() => setRefreshing(true)}
          title={linked ? undefined : tr("请先在编辑资料中关联平台专辑页面。")}>{tr("刷新资料")}</button>
        <button type="button" disabled={saved.loading} onClick={() => setEditing(true)}>{tr("编辑资料")}</button>
        {!!saved.data?.length && <button type="button" onClick={() => setClearTarget(album)}>{tr("清空刮削资料")}</button>}
      </div>
      <ErrorNotice error={saved.error} retry={saved.reload} />
      {saved.loading && <p className="muted" role="status">{tr("正在加载…")}</p>}
      {saved.data && <AlbumMetadata key={album.albumId} album={album} fields={saved.data} collapsibleTrackList />}
    </section>}
    {autoOpen && <AutoAlbumScrape albumId={album.albumId} name={album.name} provider={provider}
      close={changed => { setAutoOpen(false); if (changed) refresh(); }} />}
    {searchOpen && <Modal title={tr("搜索在线资料")} close={() => { if (!saving) setSearchOpen(false); }}>
      <ErrorNotice error={saved.error} retry={saved.reload} />
      {saved.loading && <p role="status">{tr("正在加载…")}</p>}
      {saved.data && <AlbumScraperSearch album={album} previews={previews} artist={artist} hasSavedFields={saved.data.length > 0}
        applied={() => { setSearchOpen(false); applied(); }}
        refresh={() => { setSearchOpen(false); refresh(); }} savingChanged={setSaving} />}
    </Modal>}
    {editing && <Modal title={tr("编辑专辑资料")} close={() => { if (!saving) setEditing(false); }}>
      <AlbumEditor album={album} initialPublisher={album.publisher ?? online?.publisher}
        initialReleaseDate={album.releaseDate ?? online?.date} applied={() => { setEditing(false); applied(); }}
        refresh={() => { setEditing(false); refresh(); }} savingChanged={setSaving} />
    </Modal>}
    {refreshing && <Modal title={tr("对比专辑资料")} close={() => { if (!saving) setRefreshing(false); }}>
      <AlbumRefresh album={album} previews={previews} applied={() => { setRefreshing(false); applied(); }} savingChanged={setSaving} />
    </Modal>}
    {clearTarget?.albumId === album.albumId && <AlbumScrapeClear album={clearTarget} api={api}
      close={() => setClearTarget(null)} reload={() => { setClearTarget(null); applied(); }} />}
  </>;
}
