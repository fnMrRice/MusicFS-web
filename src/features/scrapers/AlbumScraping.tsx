import { useMemo, useState } from "react";
import type { MusicAlbum } from "../../api/music-catalog";
import { ScrapersApi } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { scrapedFieldName } from "./fields";
import { ScrapedPreview } from "./ScrapedPreview";
import { ScraperSearch } from "./ScraperSearch";

const albumFields = ["albumDetails", "albumTracks", "artwork"];

export function AlbumScraping({ album, artist, refresh }: { album: MusicAlbum; artist?: string; refresh: () => void }) {
  useLocale();
  const client = useServices().client;
  const api = useMemo(() => new ScrapersApi(client), [client]);
  const saved = useResource(`album-scraped:${album.albumId}:${album.revision}`, (signal) => api.savedAlbum(album.albumId, signal));
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const finish = () => { setOpen(false); refresh(); };
  return <section className="album-scraping" aria-label={tr("刮削资料")}>
    <div className="category-heading"><h3>{tr("刮削资料")}</h3>
      <button onClick={() => setOpen(true)}>{tr("搜索在线资料")}</button>
    </div>
    <ErrorNotice error={saved.error} retry={saved.reload} />
    {!!saved.data?.length && <div className="scraped-saved">
      {saved.data.map((entry) => <details className="scraper-result" key={entry.field}>
        <summary><strong>{scrapedFieldName(entry.field)}</strong> · {entry.item.title}</summary>
        <small>{entry.pluginId}</small>
        <ScrapedPreview item={entry.item} />
      </details>)}
    </div>}
    {open && <Modal title={tr("搜索在线资料")} close={() => { if (!saving) setOpen(false); }}>
      <ScraperSearch preferredField="albumDetails" allowedFields={albumFields}
        initial={{ title: album.name, artist }}
        apply={(field, pluginId, candidate, key) => api.applyAlbum(album.albumId, field, album.revision, pluginId, candidate.candidateToken, key)}
        canApply={(field) => albumFields.includes(field)} finished={finish} refresh={finish} savingChanged={setSaving} />
    </Modal>}
  </section>;
}
