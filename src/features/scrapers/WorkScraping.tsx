import { useMemo, useState } from "react";
import { ScrapersApi } from "../../api/scrapers";
import type { Work } from "../../api/works";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { scrapedFieldName } from "./fields";
import { ScrapedPreview } from "./ScrapedPreview";
import { ScraperSearch } from "./ScraperSearch";

export function WorkScraping({ work, editable, refresh }: { work: Work; editable: boolean; refresh: () => void }) {
  useLocale();
  const client = useServices().client;
  const api = useMemo(() => new ScrapersApi(client), [client]);
  const saved = useResource(`work-scraped:${work.workId}:${work.revision}`, (signal) => api.saved(work.workId, signal));
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const finish = () => { setOpen(false); refresh(); };
  return <section className="work-panel" aria-label={tr("刮削资料")}>
    <h3>{tr("刮削资料")}</h3>
    {editable && <button onClick={() => setOpen(true)}>{tr("搜索在线资料")}</button>}
    <ErrorNotice error={saved.error} retry={saved.reload} />
    {!!saved.data?.length && <div className="scraped-saved">
      {saved.data.map((entry) => <details className="scraper-result" key={entry.field}>
        <summary><strong>{scrapedFieldName(entry.field)}</strong> · {entry.item.title}</summary>
        <small>{entry.pluginId}</small>
        <ScrapedPreview item={entry.item} />
      </details>)}
    </div>}
    {open && editable && <Modal title={tr("搜索在线资料")} close={() => { if (!saving) setOpen(false); }}>
      <ScraperSearch preferredField={work.contentType === "cd_album" ? "albumDetails" : "workDetails"}
        externalIds={work.externalIds}
        initial={{ title: work.title, artist: work.credits.find((credit) => credit.role === "artist")?.name }}
        apply={(field, pluginId, candidate, key) => api.apply(work.workId, field, work.revision, pluginId, candidate.candidateToken, key)}
        canApply={() => true} finished={finish} refresh={finish} savingChanged={setSaving} />
    </Modal>}
  </section>;
}
