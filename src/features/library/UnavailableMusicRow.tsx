import type { ReactNode } from "react";
import type { MusicTrack } from "../../api/music-catalog";
import { catalogArtworkPath } from "../../api/artwork";
import { Cover } from "../../components/ui";
import { TrackRowActions } from "../../components/TrackRowActions";
import { tr } from "../../i18n";
import { OtherTrackTitles } from "./OtherTrackTitles";

interface Props {
  credits: ReactNode; showSource: boolean;
  track: MusicTrack; number: number; checked: boolean; isFavorite: boolean; favoriteDisabled: boolean; menuExpanded: boolean;
  toggle(): void; favorite(): void; openMenu(x: number, y: number, origin: HTMLElement): void;
}
export function UnavailableMusicRow({ track, credits, showSource, number, checked, toggle, isFavorite, favoriteDisabled, favorite, menuExpanded, openMenu }: Props) {
  return <tr className={`unavailable source-missing ${checked ? "checked" : ""}`} onContextMenu={(event) => {
    event.preventDefault(); openMenu(event.clientX, event.clientY, event.currentTarget);
  }}>
    <td><input type="checkbox" aria-label={tr("选择 {0}", { 0: track.title })} checked={checked} onChange={toggle} /></td>
    <td className="row-number">{number}</td>
    <td><div className="track-title">
      <Cover src={catalogArtworkPath(track.coverPath)} />
      <div><span className="track-play"><span>{track.title}</span></span><OtherTrackTitles title={track.title} names={track.localizedTitles} /></div>
    </div></td>
    {credits}
    {showSource && <td>{tr(track.playbackSelection?.forcedSourceTrackId ? "指定来源不可用" : "暂无来源")}</td>}
    <td>—</td><td className="duration">—</td><td className="track-actions-cell"><TrackRowActions title={track.title}
      play={null} enqueue={null} favorite={{ active: isFavorite, disabled: favoriteDisabled, toggle: favorite }}
      openMenu={openMenu} menuExpanded={menuExpanded} /></td>
  </tr>;
}
