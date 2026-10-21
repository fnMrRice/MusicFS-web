import type { SourceTrack } from "../../api/types";
import { useServices } from "../../app/services";
import { duration, Icon } from "../../components/ui";
import { useSourceName } from "../../components/use-source-name";
import { tr } from "../../i18n";

export function TrackEvidence({ track }: { track: SourceTrack }) {
  const services = useServices();
  const sourceName = useSourceName();
  return <div className="matching-track">
    <strong>{track.title || track.displayName}</strong>
    <span className="muted">{track.artists?.join(" / ") || tr("未知歌手")}</span>
    <span>{sourceName(track.providerInstanceId)} · {(track.container || track.codec)?.toUpperCase() || "—"} · {duration(track.durationMs)}</span>
    <small className="muted">{track.displayName}</small>
    <button className="text-button" disabled={track.availability !== "available"} onClick={() => services.play(track)}
      aria-label={tr("试听 {0}", { 0: track.displayName })}><Icon name="play" size={14} /> {tr("试听")}</button>
  </div>;
}
