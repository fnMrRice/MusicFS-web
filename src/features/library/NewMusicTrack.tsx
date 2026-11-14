import { useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";

export function NewMusicTrack({ close, saved }: { close: () => void; saved: () => void }) {
  const services = useServices();
  const [title, setTitle] = useState("");
  const [artists, setArtists] = useState("");
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const pending = useRef(false);
  const save = async () => {
    if (pending.current || !title.trim()) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    try {
      await services.musicCatalog.createTrack(title.trim(), artists.split("\n").map((s) => s.trim()).filter(Boolean), key.current);
      services.invalidateLibraries();
      saved();
    } catch (failure) {
      const uncertain = !(failure instanceof ApiError) || failure.status === 0 || failure.status >= 500;
      if (!uncertain) key.current = null;
      setLocked(uncertain);
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return <Modal title={tr("新建曲目")} close={() => { if (!saving) close(); }}>
    <form className="catalog-track-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>{tr("曲名")}<input required value={title} disabled={saving || locked}
        onChange={(event) => setTitle(event.target.value)} /></label>
      <label>{tr("歌手（每行一个，可选）")}<textarea rows={3} value={artists} disabled={saving || locked}
        onChange={(event) => setArtists(event.target.value)} /></label>
      <ErrorNotice error={error} />
      <div className="list-actions">
        <button className="primary" disabled={saving || !title.trim()}>{tr(locked ? "重试" : "保存")}</button>
        <button type="button" disabled={saving} onClick={close}>{tr("取消")}</button>
      </div>
    </form>
  </Modal>;
}
