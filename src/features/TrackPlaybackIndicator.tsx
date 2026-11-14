import { useSyncExternalStore } from "react";
import { useServices } from "../app/services";
import { Icon } from "../components/ui";
import { tr } from "../i18n";

const loadingLabels = {
  resolving: "正在准备播放…",
  loading: "正在加载…",
  buffering: "正在缓冲…",
  seeking: "正在定位…",
  recovering: "正在恢复…",
};

export function TrackPlaybackIndicator({ number }: { number: number }) {
  const { playerState } = useServices();
  const phase = useSyncExternalStore(playerState.subscribe, () => {
    const { phase, wantsPlay } = playerState.value;
    return phase === "paused" && wantsPlay ? "loading" : phase;
  });

  if (phase === "idle" || phase === "ended" || phase === "error") return number;
  if (phase === "paused") {
    return <span className="track-indicator" role="img" aria-label={tr("已暂停")}><Icon name="pause" size={14} /></span>;
  }
  const playing = phase === "playing";
  return (
    <span className={`track-indicator ${playing ? "track-bars" : "track-dots"}`}
      role="img" aria-label={tr(playing ? "正在播放" : loadingLabels[phase])}>
      <span /><span /><span />
    </span>
  );
}
