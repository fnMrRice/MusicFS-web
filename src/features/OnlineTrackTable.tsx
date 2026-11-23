import { useState } from "react";
import type { OnlineInstance, OnlineTrack } from "../api/content";
import { duration } from "../components/ui";
import { tr } from "../i18n";
import { OnlineAudioActions } from "./OnlineAudioActions";
import { AddToPlaylist } from "./playlists/AddToPlaylist";

interface Row { position: number; track: OnlineTrack | null }

export function OnlineTrackTable({ source, rows }: { source: OnlineInstance; rows: Row[] }) {
  const playable = source.capabilities.some((c) => c.name === "stream.resolve" && c.supported);
  const accountId = source.capabilities.some((c) => c.name === "playlist.addTracks" && c.supported) ? source.accountId : undefined;
  const [adding, setAdding] = useState<OnlineTrack | null>(null);
  return <>
    <div className="table-wrap"><table className="tracks">
      <thead><tr><th>#</th><th>{tr("曲名")}</th><th>{tr("歌手")}</th><th>{tr("时长")}</th>{(playable || accountId) && <th>{tr("操作")}</th>}</tr></thead>
      <tbody>{rows.map(({ position, track }) => <tr key={position}>
        <td>{position + 1}</td>
        <td>{track?.title ?? tr("内容已失效或不可用")}</td>
        <td>{track?.artists.join(" / ") || "—"}</td>
        <td>{duration(track?.durationMs ?? null)}</td>
        {(playable || accountId) && <td>
          {playable && track && <OnlineAudioActions instance={source.instanceId} external={track.externalId} title={track.title} />}
          {accountId && track && <button aria-label={tr("将 {0} 添加到歌单", { 0: track.title })}
            onClick={() => setAdding(track)}>{tr("添加到歌单")}</button>}
        </td>}
      </tr>)}</tbody>
    </table></div>
    {adding && accountId && <AddToPlaylist tracks={[]} online={{ instanceId: source.instanceId, accountId, tracks: [adding] }} close={() => setAdding(null)} />}
  </>;
}
