import { coverObject, type MusicTrack } from "../../api/music-catalog";
import { Cover, Icon, IconButton } from "../../components/ui";
import { tr } from "../../i18n";

interface Props {
  track: MusicTrack; number: number; checked: boolean; isFavorite: boolean; favoriteDisabled: boolean;
  toggle(): void; favorite(): void; add(): void; openMenu(x: number, y: number, origin: HTMLElement): void;
}
export function UnavailableMusicRow({ track, number, checked, toggle, isFavorite, favoriteDisabled, favorite, add, openMenu }: Props) {
  return <tr className={`unavailable ${checked ? "checked" : ""}`} onContextMenu={(event) => {
    event.preventDefault(); openMenu(event.clientX, event.clientY, event.currentTarget);
  }}>
    <td><input type="checkbox" aria-label={tr("选择 {0}", { 0: track.title })} checked={checked} onChange={toggle} /></td>
    <td className="row-number">{number}</td>
    <td><div className="track-title">
      <Cover objectId={coverObject(track.coverPath)} />
      <button className="track-play" disabled aria-label={tr("播放 {0}", { 0: track.title })}>
        <Icon name="play" size={14} /><span>{track.title}</span>
      </button>
    </div></td>
    <td>{track.artists.map((artist) => artist.name).join(" / ") || "—"}</td>
    <td>{track.albums.map((album) => album.name).join(" / ") || "—"}</td>
    <td>{tr(track.playbackSelection?.forcedSourceTrackId ? "指定来源不可用" : "暂无来源")}</td>
    <td>—</td><td className="duration">—</td><td><div className="track-row-actions">
      <IconButton icon="heart" label={tr(isFavorite ? "取消收藏 {0}" : "收藏 {0}", { 0: track.title })}
        aria-pressed={isFavorite} disabled={favoriteDisabled} onClick={favorite} />
      <IconButton icon="plus" label={tr("将 {0} 添加到歌单", { 0: track.title })} onClick={add} />
      <IconButton icon="more" label={tr("{0} 的更多操作", { 0: track.title })} aria-haspopup="menu" onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect(); openMenu(rect.left, rect.bottom, event.currentTarget);
      }} />
    </div></td>
  </tr>;
}
