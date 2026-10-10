import { useState } from "react";
import { useServices, useStore } from "../../app/services";
import type { SourceTrack } from "../../api/types";
import { errorMessage } from "../../api/client";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
export function AddToPlaylist({
  tracks,
  close,
}: {
  tracks: SourceTrack[];
  close: () => void;
}) {
  const s = useServices();
  const playlists = useStore(s.playlists);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const binding = {
        kind: "local" as const,
        entries: tracks.map((t) => ({
          source: { sourceTrackId: t.sourceTrackId, remoteSourceId: null },
        })),
      };
      if (target) {
        const p = await s.content.playlist(target);
        await s.content.edit(p, p.name, [...p.bindings, binding]);
      } else await s.content.create(name.trim(), [binding]);
      await s.reloadPlaylists();
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="添加到歌单" close={close}>
      <p className="muted">将 {tracks.length} 首曲目保存为歌单引用。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          目标歌单
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">新建歌单</option>
            {playlists.map((p) => (
              <option value={p.playlistId} key={p.playlistId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!target && (
          <label>
            歌单名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={256}
              required
              autoFocus
            />
          </label>
        )}
        <ErrorNotice error={error} />
        <button
          className="primary"
          disabled={busy || (!target && !name.trim())}
        >
          {busy ? "正在保存…" : "保存"}
        </button>
      </form>
    </Modal>
  );
}
