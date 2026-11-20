import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import { displaySource, type MusicCategory, type MusicTrack } from "../../api/music-catalog";
import { useServices } from "../../app/services";
import { ContextMenu, type MenuAction } from "../../components/ContextMenu";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { LibraryState } from "../../library/state";
import { withProviderAvailability } from "../../library/track-availability";
import { AddToPlaylist } from "../playlists/AddToPlaylist";

export interface AlbumMenuTarget {
  item: MusicCategory;
  x: number;
  y: number;
  origin: HTMLElement;
}

type AlbumAction = "play" | "next" | "queue" | "playlist";
interface Props {
  menu: AlbumMenuTarget | null;
  close: () => void;
  provider: string;
  openAlbum: (id: string) => void;
}

export function AlbumMenu({ menu, close, provider, openAlbum }: Props) {
  useLocale();
  const services = useServices();
  const active = useRef<LibraryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failure, setFailure] = useState<{ message: string; album: MusicCategory; action: AlbumAction } | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<MusicTrack[] | null>(null);

  useEffect(() => {
    setBusy(false);
    setFeedback("");
    setFailure(null);
    setPlaylistTracks(null);
    return () => {
      active.current?.cancel();
      active.current = null;
    };
  }, [provider]);

  async function run(album: MusicCategory, action: AlbumAction) {
    if (active.current) return;
    const filter = album.id ? { albumId: album.id } : { unknown: "album" as const };
    const request = new LibraryState((providerInstanceId, after, signal) =>
      services.musicCatalog.tracks({ ...filter, providerInstanceId }, after, signal));
    active.current = request;
    setBusy(true);
    setFailure(null);
    setFeedback("");
    try {
      await request.select(provider);
      while (active.current === request && !request.snapshot.error && request.snapshot.cursor) await request.more();
      if (active.current !== request) return;
      const { items, error } = request.snapshot;
      if (error) {
        setFailure({ message: error, album, action });
        return;
      }
      if (!items.length) {
        setFeedback(tr("没有找到相关曲目"));
        return;
      }
      if (action === "playlist") {
        setPlaylistTracks(items);
        return;
      }
      const providers = new Map(services.libraryApi.providerInstances.value.map(item => [item.id, item]));
      const playable = items.map(displaySource).filter(source => source !== null)
        .map(source => withProviderAvailability(source, providers)).filter(source => source.availability === "available");
      if (!playable.length) setFeedback(tr("暂无可播放曲目"));
      else if (action === "play") services.play(playable[0], playable);
      else if (action === "next") {
        services.playNext(playable);
        setFeedback(tr("已设为下一首播放"));
      } else {
        services.enqueue(playable);
        setFeedback(tr("已将 {0} 首可用曲目加入队列", { 0: playable.length }));
      }
    } catch (cause) {
      if (active.current === request) setFailure({ message: errorMessage(cause), album, action });
    } finally {
      if (active.current === request) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  function trackAction(album: MusicCategory, label: string, icon: string, action: AlbumAction): MenuAction {
    return { label: tr(label), icon, disabled: busy || album.trackCount === 0,
      reason: album.trackCount === 0 ? tr("没有找到相关曲目") : undefined,
      run: () => void run(album, action) };
  }

  return <>
    {menu && <ContextMenu x={menu.x} y={menu.y} origin={menu.origin} label={menu.item.name || tr("未知专辑")} close={close}
      actions={[
        { label: tr("查看曲目"), icon: "album", run: () => openAlbum(menu.item.id) },
        trackAction(menu.item, "播放全部", "play", "play"),
        trackAction(menu.item, "下一首播放", "next", "next"),
        trackAction(menu.item, "加入队列", "queue", "queue"),
        trackAction(menu.item, "添加到歌单", "plus", "playlist"),
      ]} />}
    {busy && <p className="loading" role="status">{tr("正在读取曲目…")} <button type="button" onClick={() => {
      active.current?.cancel();
      active.current = null;
      setBusy(false);
    }}>{tr("取消")}</button></p>}
    {feedback && <p className="feedback" role="status">{feedback}</p>}
    <ErrorNotice error={failure?.message ?? null} retry={failure ? () => void run(failure.album, failure.action) : undefined} />
    {playlistTracks && <AddToPlaylist tracks={playlistTracks} close={() => setPlaylistTracks(null)} />}
  </>;
}
