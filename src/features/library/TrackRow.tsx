import { Fragment, useState, type ReactNode } from "react";
import { tr, useLocale } from "../../i18n";
import type { SourceTrack } from "../../api/types";
import { useServices, useStore } from "../../app/services";
import { duration, Icon, IconButton } from "../../components/ui";
import { TrackVersions } from "../matching/TrackVersions";
import { TrackCover } from "../../components/TrackCover";
import { trackAvailabilityMessage } from "../../library/track-availability";
import { TrackPlaybackIndicator } from "../TrackPlaybackIndicator";
import type { LocalizedTitle } from "../../api/localized-titles";
import { OtherTrackTitles } from "./OtherTrackTitles";
import { SourceDownloads } from "./SourceDownloads";

export function TrackRow({
  track: t,
  credits,
  localizedTitles,
  number,
  provider,
  checked,
  toggle,
  add,
  isFavorite,
  favoriteDisabled,
  toggleFavorite,
  playNext,
  openMenu,
  openVersionMenu,
  matchingRevision,
  onMatchingChange,
}: {
  track: SourceTrack;
  credits: ReactNode;
  localizedTitles?: LocalizedTitle[];
  number: number;
  provider?: string;
  checked: boolean;
  toggle: () => void;
  add: () => void;
  isFavorite: boolean;
  favoriteDisabled: boolean;
  toggleFavorite: () => void;
  playNext: () => void;
  openMenu: (x: number, y: number, origin: HTMLElement) => void;
  openVersionMenu: (track: SourceTrack, x: number, y: number, origin: HTMLElement) => void;
  matchingRevision?: number;
  onMatchingChange?: () => void;
}) {
  useLocale();
  const s = useServices();
  const currentTrack = useStore(s.currentTrack);
  const [expanded, setExpanded] = useState(false);
  const versions = t.versions ?? [t];
  const title = t.title || t.displayName;
  const isCurrent = versions.some((version) => version.sourceTrackId === currentTrack);
  return (
    <Fragment>
    <tr
      className={`${isCurrent ? "current" : ""} ${checked ? "checked" : ""} ${t.availability !== "available" ? "unavailable" : ""}`}
      tabIndex={-1}
      onContextMenu={(event) => { event.preventDefault(); openMenu(event.clientX, event.clientY, event.currentTarget); }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const origin = event.target as HTMLElement;
          const rect = origin.getBoundingClientRect();
          openMenu(rect.left, rect.bottom, origin);
        }
      }}
    >
      <td>
        <input
          type="checkbox"
          checked={checked}
          onChange={toggle}
          aria-label={tr("选择 {0}", { "0": t.title || t.displayName })}
        />
      </td>
      <td className="row-number">
        {isCurrent ? <TrackPlaybackIndicator number={number} /> : number}
      </td>
      <td>
        <div className="track-title">
          <TrackCover track={t} />
          <div>
            <button
              className="track-play"
              aria-label={tr("播放 {0}", { 0: title })}
              title={tr("播放 {0}", { 0: title })}
              disabled={t.availability !== "available"}
              onClick={() => s.play(t)}
            >
              <Icon name="play" size={14} />
              <span>{t.title || t.displayName}</span>
            </button>
            <OtherTrackTitles title={title} names={localizedTitles} />
            {versions.length === 1 && <SourceDownloads key={versions[0].sourceTrackId} track={versions[0]} />}
            {versions.length > 1 && <button className="text-button track-expand" aria-expanded={expanded}
              aria-label={tr("展开 {0} 的来源版本", { 0: t.title || t.displayName })}
              onClick={() => setExpanded(!expanded)}>
              <Icon name="chevron" size={14} />{tr("{0} 个来源版本", { 0: versions.length })}
            </button>}
            {t.availability !== "available" && (
              <small className="availability">
                {tr(trackAvailabilityMessage(t.availability))}
              </small>
            )}
          </div>
        </div>
      </td>
      {credits}
      {provider !== undefined && <td>{provider}</td>}
      <td>
        <span className="format">
          {(t.container || t.codec)?.toUpperCase() ?? "—"}
        </span>
      </td>
      <td className="duration">{duration(t.durationMs)}</td>
      <td>
        <div className="track-row-actions">
          <IconButton icon="heart" label={tr(isFavorite ? "取消收藏 {0}" : "收藏 {0}", { 0: t.title || t.displayName })}
            aria-pressed={isFavorite} className={isFavorite ? "is-favorite" : undefined}
            disabled={favoriteDisabled} onClick={toggleFavorite} />
          <IconButton icon="next" label={tr("将 {0} 设为下一首播放", { 0: t.title || t.displayName })}
            disabled={t.availability !== "available"} onClick={playNext} />
          <IconButton icon="plus" label={tr("将 {0} 添加到歌单", { 0: title })} onClick={add} />
          <IconButton icon="more" label={tr("{0} 的更多操作", { 0: t.title || t.displayName })} aria-haspopup="menu"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              openMenu(rect.left, rect.bottom, event.currentTarget);
            }} />
        </div>
      </td>
    </tr>
    {expanded && versions.length > 1 && <tr className="track-versions"><td colSpan={provider === undefined ? 8 : 9}>
      <TrackVersions tracks={versions} revision={matchingRevision} refresh={onMatchingChange}
        openActions={openVersionMenu}
        recordingId={t.recordingId} defaultSourceTrackId={t.sourceTrackId} manualSourceTrackId={t.manualSourceTrackId} />
    </td></tr>}
    </Fragment>
  );
}
