import { Fragment, useState, type ReactNode } from "react";
import { tr, useLocale } from "../../i18n";
import type { SourceTrack } from "../../api/types";
import { useServices, useStore } from "../../app/services";
import { duration, Icon } from "../../components/ui";
import { TrackRowActions } from "../../components/TrackRowActions";
import type { MenuAction } from "../../components/ContextMenu";
import { TrackVersions } from "../matching/TrackVersions";
import { TrackCover } from "../../components/TrackCover";
import { trackAvailabilityMessage } from "../../library/track-availability";
import { TrackPlaybackIndicator } from "../TrackPlaybackIndicator";
import type { LocalizedTitle } from "../../api/localized-titles";
import { OtherTrackTitles } from "./OtherTrackTitles";

export function TrackRow({
  track: t,
  credits,
  localizedTitles,
  number,
  provider,
  checked,
  toggle,
  enqueue,
  isFavorite,
  favoriteDisabled,
  toggleFavorite,
  menuExpanded,
  openMenu,
  versionMenuActions,
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
  enqueue: () => void;
  isFavorite: boolean;
  favoriteDisabled: boolean;
  toggleFavorite: (sourceTrackId?: string) => void;
  menuExpanded: boolean;
  openMenu: (x: number, y: number, origin: HTMLElement) => void;
  versionMenuActions: (track: SourceTrack) => MenuAction[];
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
              title={tr("播放 {0}", { 0: title })}
              disabled={t.availability !== "available"}
              onClick={() => s.play(t)}
            >
              <span>{t.title || t.displayName}</span>
            </button>
            <OtherTrackTitles title={title} names={localizedTitles} />
            {versions.length > 0 && <button className="text-button track-expand" aria-expanded={expanded}
              aria-label={tr(expanded ? "收起 {0} 的来源版本" : "展开 {0} 的来源版本", { 0: title })}
              onClick={() => setExpanded(!expanded)}>
              <Icon name="chevron" size={14} />{versions.length === 1 ? tr("1 个来源版本") : tr("{0} 个来源版本", { 0: versions.length })}
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
      <td className="track-actions-cell">
        <TrackRowActions title={title} play={() => s.play(t)} enqueue={enqueue}
          playbackDisabled={t.availability !== "available"}
          favorite={{ active: isFavorite, disabled: favoriteDisabled, toggle: () => toggleFavorite() }}
          openMenu={openMenu} menuExpanded={menuExpanded} />
      </td>
    </tr>
    {expanded && versions.length > 0 && <tr className="track-versions"><td colSpan={provider === undefined ? 8 : 9}>
      <TrackVersions tracks={versions} revision={matchingRevision} refresh={versions.length > 1 ? onMatchingChange : undefined}
        menuActions={versionMenuActions} isFavorite={isFavorite} favoriteDisabled={favoriteDisabled}
        toggleFavorite={toggleFavorite}
        recordingId={t.recordingId} defaultSourceTrackId={t.sourceTrackId} manualSourceTrackId={t.manualSourceTrackId} />
    </td></tr>}
    </Fragment>
  );
}
