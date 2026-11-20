import { useState } from "react";
import { ApiError, type ApiClient } from "../../api/client";
import { isLocalizedTitle, mergeScrapedTitles, type LocalizedTitle } from "../../api/localized-titles";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { tr, useLocale } from "../../i18n";
import { ScraperSearch } from "../scrapers/ScraperSearch";
import { LocalizedNamesForm } from "./LocalizedNamesForm";

export interface NamedArtist {
  artistId: string;
  name: string;
  namesRevision: number;
  localizedNames?: LocalizedTitle[];
}

function checkArtist(value: unknown, id: string): NamedArtist {
  if (!value || typeof value !== "object" || !("artistId" in value) || value.artistId !== id ||
    !("name" in value) || typeof value.name !== "string" || !("namesRevision" in value) ||
    !Number.isSafeInteger(value.namesRevision) || Number(value.namesRevision) < 1 ||
    "localizedNames" in value && (!Array.isArray(value.localizedNames) || !value.localizedNames.every(isLocalizedTitle))) {
    throw new ApiError("INVALID_RESPONSE", "Invalid music artist names");
  }
  return value as NamedArtist;
}
export async function readNamedArtist(client: ApiClient, id: string, signal: AbortSignal) {
  return checkArtist(await client.request<unknown>(`/library/artists/${encodeURIComponent(id)}`, { signal }), id);
}
export function ArtistNames({ artist, refresh }: { artist: NamedArtist; refresh: () => void }) {
  useLocale();
  const { client } = useServices();
  const [mode, setMode] = useState<"edit" | "search">();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<LocalizedTitle[]>();
  const names = artist.localizedNames ?? [];
  const close = () => { setMode(undefined); setDraft(undefined); };
  const applied = () => { close(); refresh(); };
  async function save(localizedNames: LocalizedTitle[], key: string) {
    const result = await client.request<unknown>(`/library/artists/${encodeURIComponent(artist.artistId)}/names`, {
      method: "PUT", body: { expectedRevision: artist.namesRevision, localizedNames }, idempotencyKey: key,
    });
    checkArtist(result, artist.artistId);
  }
  return <>
    <button type="button" className="album-details-toggle" onClick={() => setMode("edit")}>{tr("多语言歌手名")}</button>
    {mode && <Modal title={tr("多语言歌手名")} close={() => { if (!busy) close(); }}>
      <h3>{artist.name}</h3>
      {mode === "edit" ? <>
        <button onClick={() => setMode("search")} disabled={busy}>{tr("搜索在线资料")}</button>
        <LocalizedNamesForm names={names} initialNames={draft} draftChanged={setDraft} save={save} applied={applied}
          refresh={applied} busyChanged={setBusy} titleLabel={tr("歌手名称")} />
      </> : <ScraperSearch initial={{ artist: artist.name }} preferredField="artistDetails" allowedFields={["artistDetails"]} canApply={() => true}
        apply={async (_field, _plugin, item) => {
          setDraft(mergeScrapedTitles(artist.name, draft ?? names, { title: item.title, localizedTitles: item.localizedArtistNames }));
        }}
        finished={() => setMode("edit")} refresh={applied} savingChanged={setBusy} />}
    </Modal>}
  </>;
}
