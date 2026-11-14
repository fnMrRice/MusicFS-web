import { tr } from "../../i18n";
import { trackTitle, type TrackItem } from "../../api/music-catalog";
import { useSourceName } from "../../components/use-source-name";

export function PlaylistSourceSelect({ track, value, change }: {
  track: TrackItem; value: string; change: (id: string) => void;
}) {
  const sourceName = useSourceName();
  const group = "trackId" in track ? track.selectedSource : track;
  const versions = group?.versions ?? (group ? [group] : []);
  return <label>{tr("{0} 的歌单播放来源", { 0: trackTitle(track) })}
    <select value={value} onChange={(event) => change(event.target.value)}>
      <option value="">{tr("跟随曲目默认来源")}</option>
      {value && !versions.some((v) => v.sourceTrackId === value) &&
        <option value={value} disabled>{tr("指定来源不可用")}</option>}
      {versions.map((v) => <option key={v.sourceTrackId} value={v.sourceTrackId}>
        {sourceName(v.providerInstanceId)} · {v.displayName}
      </option>)}
    </select>
  </label>;
}
