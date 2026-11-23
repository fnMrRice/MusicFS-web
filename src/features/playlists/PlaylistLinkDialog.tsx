import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { changePlaylistLink, favoritesPlaylistId, type PlaylistLinkTarget } from "../../api/playlist-links";
import { useServices, useStore } from "../../app/services";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";

export function PlaylistLinkDialog({ target, title, linkedId, close, changed }: {
  target: PlaylistLinkTarget; title: string; linkedId?: string; close: () => void; changed: () => void;
}) {
  const s = useServices();
  const local = useStore(s.playlists);
  const [choice, setChoice] = useState(local[0]?.playlistId ?? "");
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = useRef<AbortController | null>(null);
  useEffect(() => () => submit.current?.abort(), []);
  async function save() {
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    submit.current = controller;
    try {
      let playlistId = linkedId || choice;
      if (!playlistId) {
        const playlist = await s.content.create(name.trim());
        playlistId = playlist.playlistId;
        setChoice(playlistId);
        await s.reloadPlaylists();
      }
      await changePlaylistLink(s.client, target, playlistId, !!linkedId, controller.signal);
      changed();
      close();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("关联已变更，请关闭并查看当前关联。");
        changed();
      } else setError(errorMessage(e));
    } finally { setBusy(false); }
  }
  return <Modal title={tr(linkedId ? "解除关联" : "关联本地歌单")} close={() => { if (!busy) close(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p>{title}</p>
      {linkedId
        ? <p>{tr("解除与「{0}」的关联后，新添加的曲目将停止同步到这张远程歌单。", {
          0: linkedId === favoritesPlaylistId ? tr("我的收藏") : local.find((item) => item.playlistId === linkedId)?.name ?? linkedId,
        })}</p>
        : <>
          <label>{tr("本地歌单")}
            <select value={choice} onChange={(event) => setChoice(event.target.value)} disabled={busy}>
              <option value={favoritesPlaylistId}>{tr("我的收藏")}</option>
              {local.map((item) => <option key={item.playlistId} value={item.playlistId}>{item.name}</option>)}
              <option value="">{tr("新建歌单")}</option>
            </select>
          </label>
          {!choice && <label>{tr("歌单名称")}
            <input required maxLength={256} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
          </label>}
          <p className="muted">{tr("远程曲目将加入曲库和所选歌单。以后在本地添加的同平台曲目也会同步到远程歌单。")}</p>
        </>}
      <ErrorNotice error={error} />
      <button className="primary" disabled={busy || (!linkedId && !choice && !name.trim())}>
        {tr(busy ? "正在保存…" : linkedId ? "解除关联" : "关联本地歌单")}
      </button>
    </form>
  </Modal>;
}
