import type { ComponentProps } from "react";
import type { OnlineTrack } from "../api/content";
import type { MenuAction } from "../components/ContextMenu";
import { TrackRowActions } from "../components/TrackRowActions";
import { Cover, duration } from "../components/ui";
import { tr } from "../i18n";
import { OnlineAudioFeedback, useOnlineAudioActions } from "./OnlineAudioActions";
import { externalLink } from "./scrapers/fields";
import { versionLabel } from "./library/download-format";
import { formatPair } from "../player/format";

interface Props {
  instance: string;
  track: OnlineTrack | null;
  position?: number;
  showAlbum?: boolean;
  playable: boolean;
  favorite?: ComponentProps<typeof TrackRowActions>["favorite"];
  add?: (track: OnlineTrack) => void;
  download?: (track: OnlineTrack) => void;
  select?: (id: string) => void;
  selected: boolean;
}

export function OnlineTrackRow({ instance, track, position, showAlbum, playable, favorite, add, download, select, selected }: Props) {
  const audio = useOnlineAudioActions(instance, track?.externalId);
  const title = track?.title ?? tr("内容已失效或不可用");
  const cover = <Cover src={externalLink(track?.coverUrl ?? undefined)} />;
  const versions = track?.downloadVersions ?? [];
  const formats = [...new Set(versions.filter(v => v.formatMeasured).map(v => formatPair(v.container, v.codec)).filter(Boolean))];
  const menu: MenuAction[] = [];
  if (track && add) menu.push({ label: tr("添加到歌单"), icon: "plus", run: () => add(track) });
  if (track && download) menu.push({ label: tr("下载"), icon: "download", run: () => download(track) });
  return <tr className={selected ? "checked" : undefined}>
    {select && <td>{track && <input type="checkbox" checked={selected}
      aria-label={tr("选择 {0}", { 0: title })} onChange={() => select(track.externalId)} />}</td>}
    {position !== undefined && <td>{position + 1}</td>}
    <td aria-label={title}>
      {playable && track
        ? <button type="button" className="track-play online-track-title" disabled={audio.busy}
            title={tr("播放 {0}", { 0: title })} onClick={audio.play}>
            {cover}<span>{title}</span>
          </button>
        : <span className="online-track-title">{cover}<span>{title}</span></span>}
      {versions.length === 1 && <small className="online-download-format">{tr("已下载")} · {versionLabel(versions[0])}</small>}
      {versions.length > 1 && <details className="online-download-format">
        <summary>{[tr("已下载 · {0} 个版本", { 0: versions.length }), ...formats].join(" · ")}</summary>
        <ul>{versions.map(version => <li key={version.versionId}>{versionLabel(version)}</li>)}</ul>
      </details>}
    </td>
    <td>{track?.artists.join(" / ") || "—"}</td>
    {showAlbum && <td>{track?.album || "—"}</td>}
    <td>{duration(track?.durationMs ?? null)}</td>
    {(playable || add || download) && <td className="track-actions-cell">{track && <>
      <TrackRowActions title={title} play={playable ? audio.play : undefined}
        enqueue={playable ? audio.enqueue : undefined} playbackDisabled={audio.busy}
        favorite={favorite} menuActions={menu} />
      <OnlineAudioFeedback {...audio} />
    </>}</td>}
  </tr>;
}
