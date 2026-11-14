import { useState } from "react";
import type { FavoriteEntry } from "../../api/favorites";
import { errorMessage } from "../../api/client";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { PlaylistSourceSelect } from "../playlists/PlaylistSourceSelect";

export function FavoriteSource({ entry, close }: { entry: FavoriteEntry; close: () => void }) {
  const s = useServices();
  const [value, setValue] = useState(entry.forcedSourceTrackId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try { await s.favorites.setFavorite(entry.musicTrack, true, value || null); close(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <Modal title={tr("编辑收藏来源")} close={close}><form onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <PlaylistSourceSelect track={entry.musicTrack} value={value} change={setValue} />
    <ErrorNotice error={error} />
    <button className="primary" disabled={busy}>{tr("保存修改")}</button>
  </form></Modal>;
}
