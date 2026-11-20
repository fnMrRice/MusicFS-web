import { useMemo, useState } from "react";
import type { MusicAlbum } from "../../api/music-catalog";
import { ScrapersApi } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { AlbumMetadata } from "./AlbumMetadata";
import { AlbumScraperSearch } from "./AlbumScraperSearch";
import { AlbumEditor } from "./AlbumEditor";
import { AlbumRefresh } from "./AlbumRefresh";
import { externalLink } from "./fields";
import "./scrapers.css";

export function AlbumScraping({ album, artist, detailsId, detailsOpen, searchOpen, closeSearch, applied, refresh }: {
  album: MusicAlbum; artist?: string; detailsId: string; detailsOpen: boolean; searchOpen: boolean;
  closeSearch: () => void; applied: () => void; refresh: () => void;
}) {
  useLocale();
  const client = useServices().client;
  const api = useMemo(() => new ScrapersApi(client), [client]);
  const saved = useResource(`album-scraped:${album.albumId}:${album.revision}`, (signal) => api.savedAlbum(album.albumId, signal));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const online = saved.data?.find((entry) => entry.field === "albumDetails")?.item;
  const linked = album.sourceLinks.some(link => !!externalLink(link.url));
  return <>
    {detailsOpen && <section id={detailsId} className="album-metadata" aria-label={tr("专辑详情")}>
      <div className="album-metadata-actions">
        <button type="button" disabled={saved.loading || !linked} onClick={() => setRefreshing(true)}
          title={linked ? undefined : tr("请先在编辑资料中关联平台专辑页面。")}>{tr("刷新资料")}</button>
        <button type="button" disabled={saved.loading} onClick={() => setEditing(true)}>{tr("编辑资料")}</button>
      </div>
      <ErrorNotice error={saved.error} retry={saved.reload} />
      {saved.loading && <p className="muted" role="status">{tr("正在加载…")}</p>}
      {saved.data && <AlbumMetadata album={album} fields={saved.data} />}
    </section>}
    {searchOpen && <Modal title={tr("搜索在线资料")} close={() => { if (!saving) closeSearch(); }}>
      <ErrorNotice error={saved.error} retry={saved.reload} />
      {saved.loading && <p role="status">{tr("正在加载…")}</p>}
      {saved.data && <AlbumScraperSearch album={album} artist={artist} hasSavedFields={saved.data.length > 0}
        applied={applied} refresh={refresh} savingChanged={setSaving} />}
    </Modal>}
    {editing && <Modal title={tr("编辑专辑资料")} close={() => { if (!saving) setEditing(false); }}>
      <AlbumEditor album={album} initialPublisher={album.publisher ?? online?.publisher}
        initialReleaseDate={album.releaseDate ?? online?.date} applied={() => { setEditing(false); applied(); }}
        refresh={() => { setEditing(false); refresh(); }} savingChanged={setSaving} />
    </Modal>}
    {refreshing && <Modal title={tr("对比专辑资料")} close={() => { if (!saving) setRefreshing(false); }}>
      <AlbumRefresh album={album} applied={() => { setRefreshing(false); applied(); }} savingChanged={setSaving} />
    </Modal>}
  </>;
}
