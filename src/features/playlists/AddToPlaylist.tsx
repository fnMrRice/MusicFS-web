import { tr, useLocale } from "../../i18n";
import { useRef, useState } from "react";
import { useServices, useStore } from "../../app/services";
import { trackKey, type TrackItem } from "../../api/music-catalog";
import { PlaylistSourceSelect } from "./PlaylistSourceSelect";
import { useResource } from "../../components/query";
import { errorMessage } from "../../api/client";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { TrackSelectionApi, type TrackSelection } from "../../api/track-selection";
export function AddToPlaylist({
  tracks,
  pinned,
  selection,
  close,
}: {
  tracks: TrackItem[];
  pinned?: string;
  selection?: TrackSelection;
  close: () => void;
}) {
  useLocale();
  const s = useServices();
  const playlists = useStore(s.playlists);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const pending = useRef<{ identity: string; key: string; revision?: number } | null>(null);
  const resolved = useResource(JSON.stringify(tracks.map(trackKey)), async (signal) => {
    if (selection) return [];
    const result = [];
    for (const item of tracks) {
      result.push("trackId" in item ? item : await s.musicCatalog.track(item.sourceTrackId, signal, true));
    }
    return result;
  });
  const save = async () => {
    if (!selection && !resolved.data) return;
    setBusy(true);
    setError(null);
    try {
      if (selection) {
        const identity = JSON.stringify({ selection, target, name: name.trim() });
        if (pending.current?.identity !== identity) pending.current = { identity, key: crypto.randomUUID() };
        const api = new TrackSelectionApi(s.client);
        if (target) {
          const selected = playlists.find((playlist) => playlist.playlistId === target);
          if (pending.current.revision === undefined) pending.current.revision = selected?.ruleRevision ?? (await s.content.playlist(target)).ruleRevision;
          await api.appendPlaylist(target, selection, pending.current.revision, pending.current.key);
        } else await api.createPlaylist(selection, name.trim(), pending.current.key);
      } else {
      const binding = {
        kind: "local" as const,
        entries: resolved.data!.map((t, i) => ({
          source: { trackId: t.trackId, forcedSourceTrackId: (choices[i] ?? pinned) || null, sourceTrackId: null, remoteSourceId: null },
        })),
      };
      if (target) {
        const p = await s.content.playlist(target);
        await s.content.edit(p, p.name, [...p.bindings, binding]);
      } else await s.content.create(name.trim(), [binding]);
      }
      await s.reloadPlaylists();
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={tr("添加到歌单")} close={close}>
      <p className="muted">
        {selection ? tr("全部选中曲目") : tr("将 {0} 首曲目保存为歌单引用。", { 0: tracks.length })}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          {tr("目标歌单")}
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{tr("新建歌单")}</option>
            {playlists.map((p) => (
              <option value={p.playlistId} key={p.playlistId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!target && (
          <label>
            {tr("歌单名称")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={256}
              required
              autoFocus
            />
          </label>
        )}
        {resolved.data?.map((track, i) => <PlaylistSourceSelect key={i} track={track} value={choices[i] ?? pinned ?? ""}
          change={(id) => setChoices((previous) => ({ ...previous, [i]: id }))} />)}
        <ErrorNotice error={error || resolved.error} retry={resolved.error ? resolved.reload : undefined} />
        <button
          className="primary"
          disabled={busy || (!selection && !resolved.data) || (!target && !name.trim())}
        >
          {busy ? tr("正在保存…") : tr("保存")}
        </button>
      </form>
    </Modal>
  );
}
