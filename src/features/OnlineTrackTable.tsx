import { useState } from "react";
import type { OnlineInstance, OnlineTrack } from "../api/content";
import { Cover, Icon, duration } from "../components/ui";
import { tr } from "../i18n";
import { supportsOnlinePlayback } from "../player/online-playlist-playback";
import { OnlineAudioFeedback, useOnlineAudioActions } from "./OnlineAudioActions";
import { AddToPlaylist } from "./playlists/AddToPlaylist";
import { externalLink } from "./scrapers/fields";

interface Row { position: number; track: OnlineTrack | null }

function OnlineTrackRow({ row, instance, playable, add }: {
  row: Row; instance: string; playable: boolean; add?: (track: OnlineTrack) => void;
}) {
  const { track, position } = row;
  const actions = useOnlineAudioActions(instance, track?.externalId);
  const title = track?.title ?? tr("内容已失效或不可用");
  const cover = <Cover src={externalLink(track?.coverUrl ?? undefined)} />;
  return <tr>
    <td>{position + 1}</td>
    <td aria-label={title}>
      {playable && track
        ? <button type="button" className="track-play online-track-title" disabled={actions.busy}
            aria-label={tr("播放 {0}", { 0: title })} title={tr("播放 {0}", { 0: title })} onClick={actions.play}>
            {cover}<Icon name="play" size={14} /><span>{title}</span>
          </button>
        : <span className="online-track-title">{cover}<span>{title}</span></span>}
    </td>
    <td>{track?.artists.join(" / ") || "—"}</td>
    <td>{duration(track?.durationMs ?? null)}</td>
    {(playable || add) && <td>
      {playable && track && <button type="button" disabled={actions.busy} onClick={actions.enqueue}>{tr("加入队列")}</button>}{" "}
      {add && track && <button type="button" aria-label={tr("将 {0} 添加到歌单", { 0: title })}
        onClick={() => add(track)}>{tr("添加到歌单")}</button>}
      <OnlineAudioFeedback {...actions} />
    </td>}
  </tr>;
}

export function OnlineTrackTable({ source, rows }: { source: OnlineInstance; rows: Row[] }) {
  const playable = supportsOnlinePlayback(source);
  const accountId = source.capabilities.some((c) => c.name === "playlist.addTracks" && c.supported) ? source.accountId : undefined;
  const [adding, setAdding] = useState<OnlineTrack | null>(null);
  return <>
    <div className="table-wrap"><table className="tracks">
      <thead><tr><th>#</th><th>{tr("曲名")}</th><th>{tr("歌手")}</th><th>{tr("时长")}</th>{(playable || accountId) && <th>{tr("操作")}</th>}</tr></thead>
      <tbody>{rows.map(row => <OnlineTrackRow key={row.position} row={row} instance={source.instanceId}
        playable={playable} add={accountId ? setAdding : undefined} />)}</tbody>
    </table></div>
    {adding && accountId && <AddToPlaylist tracks={[]} online={{ instanceId: source.instanceId, accountId, tracks: [adding] }} close={() => setAdding(null)} />}
  </>;
}
