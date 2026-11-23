import { useMemo, useState } from "react";
import type { Observation, OnlineInstance, OnlineTrack } from "../api/content";
import { Cover, Icon, duration } from "../components/ui";
import { tr } from "../i18n";
import { supportsOnlinePlayback } from "../player/online-playlist-playback";
import { OnlineAudioFeedback, useOnlineAudioActions } from "./OnlineAudioActions";
import { AddToPlaylist } from "./playlists/AddToPlaylist";
import { externalLink } from "./scrapers/fields";
import { OnlineDownloadDialog } from "./playlists/OnlineDownloadDialog";
import { OnlineDownloadJobs, rememberDownload } from "./playlists/OnlineDownloadJobs";

interface Row { position: number; externalId?: string; track: OnlineTrack | null }
const maxDownloadItems = 10_000;

function OnlineTrackRow({ row, instance, playable, add, download, select, selected }: {
  row: Row; instance: string; playable: boolean; add?: (track: OnlineTrack) => void;
  download?: (track: OnlineTrack) => void; select: (id: string) => void; selected: boolean;
}) {
  const { track, position } = row;
  const actions = useOnlineAudioActions(instance, track?.externalId);
  const title = track?.title ?? tr("内容已失效或不可用");
  const cover = <Cover src={externalLink(track?.coverUrl ?? undefined)} />;
  return <tr className={selected ? "checked" : undefined}>
    {download && <td>{track && <input type="checkbox" checked={selected}
      aria-label={tr("选择 {0}", { 0: title })} onChange={() => select(track.externalId)} />}</td>}
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
    {(playable || add) && <td className={download ? "online-track-actions" : undefined}>
      {playable && track && <button type="button" disabled={actions.busy} onClick={actions.enqueue}>{tr("加入队列")}</button>}{" "}
      {download && track && <button type="button" aria-label={tr("下载 {0}", { 0: title })}
        onClick={() => download(track)}>{tr("下载")}</button>}{" "}
      {add && track && <button type="button" aria-label={tr("将 {0} 添加到歌单", { 0: title })}
        onClick={() => add(track)}>{tr("添加到歌单")}</button>}
      <OnlineAudioFeedback {...actions} />
    </td>}
  </tr>;
}

export function OnlineTrackTable({ source, rows, downloadScope, observation }: {
  source: OnlineInstance; rows: Row[]; downloadScope?: string; observation?: Observation;
}) {
  const playable = supportsOnlinePlayback(source);
  const accountId = source.capabilities.some((c) => c.name === "playlist.addTracks" && c.supported) ? source.accountId : undefined;
  const [adding, setAdding] = useState<OnlineTrack | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [downloading, setDownloading] = useState<string[] | null>(null);
  const canDownload = playable && !!downloadScope;
  const available = new Map<string, OnlineTrack>();
  if (canDownload) for (const { track } of rows) {
    if (track && !available.has(track.externalId)) available.set(track.externalId, track);
  }
  const selection = [...available.values()].filter(track => checked.has(track.externalId));
  const all = available.size > 0 && selection.length === available.size;
  const playlistIds = useMemo(() => {
    if (!canDownload || !observation?.complete) return [];
    const unavailable = new Set(rows.filter(row => row.externalId && !row.track).map(row => row.externalId));
    const ids = new Set<string>();
    for (const { externalTrackId: id } of [...observation.entries].sort((a, b) => a.position - b.position)) {
      if (!unavailable.has(id) && (source.platform !== "bilibili" || !id.startsWith("unavailable:"))) ids.add(id);
    }
    return [...ids];
  }, [canDownload, observation, rows, source.platform]);
  function toggle(id: string) {
    setChecked(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  return <>
    {canDownload && <div className="list-actions">
      <button type="button" disabled={!playlistIds.length || playlistIds.length > maxDownloadItems}
        onClick={() => setDownloading(playlistIds)}>{tr("下载全部")}</button>
      <label className="check-label"><input type="checkbox" checked={all} disabled={!available.size}
        ref={node => { if (node) node.indeterminate = selection.length > 0 && !all; }}
        onChange={() => setChecked(all ? new Set() : new Set(available.keys()))} />
        {tr("全选已加载的可下载曲目")}</label>
      <button type="button" disabled={!selection.length || selection.length > maxDownloadItems}
        onClick={() => setDownloading(selection.map(track => track.externalId))}>
        {tr("下载所选（{0}）", { 0: selection.length })}</button>
      {!observation?.complete && <span role="status">{tr("歌单曲目未读取完整，请刷新歌单后再下载全部。")}</span>}
      {(playlistIds.length > maxDownloadItems || selection.length > maxDownloadItems) &&
        <span role="status">{tr("每个下载任务最多选择 10000 首曲目。")}</span>}
    </div>}
    {downloadScope && <OnlineDownloadJobs scope={downloadScope} tracks={available} />}
    <div className="table-wrap"><table className="tracks">
      <thead><tr>{canDownload && <th>{tr("选择")}</th>}<th>#</th><th>{tr("曲名")}</th><th>{tr("歌手")}</th><th>{tr("时长")}</th>{(playable || accountId) && <th>{tr("操作")}</th>}</tr></thead>
      <tbody>{rows.map(row => <OnlineTrackRow key={row.position} row={row} instance={source.instanceId}
        playable={playable} add={accountId ? setAdding : undefined}
        download={canDownload ? track => setDownloading([track.externalId]) : undefined} select={toggle}
        selected={canDownload && !!row.track && checked.has(row.track.externalId)} />)}</tbody>
    </table></div>
    {downloading && canDownload && <OnlineDownloadDialog source={source} externalIds={downloading} title={available.get(downloading[0])?.title}
      close={() => setDownloading(null)} created={(job, quality) => {
        rememberDownload(downloadScope, job, quality);
        setDownloading(null);
      }} />}
    {adding && accountId && <AddToPlaylist tracks={[]} online={{ instanceId: source.instanceId, accountId, tracks: [adding] }} close={() => setAdding(null)} />}
  </>;
}
