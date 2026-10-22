import { useId } from "react";
import { useServices, useStore } from "../app/services";
import { IconButton } from "../components/ui";
import { tr, useLocale } from "../i18n";

export function VolumeSlider({ label }: { label: string }) {
  const s = useServices();
  const { volume } = useStore(s.preferences);
  const id = useId();
  const value = `${Math.round(volume * 100)}%`;
  return (
    <span className="volume-slider">
      <input
        id={id}
        aria-label={label}
        aria-valuetext={value}
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        onChange={(event) => s.preference({ volume: Number(event.target.value) })}
      />
      <output className="volume-value" htmlFor={id} aria-hidden="true">{value}</output>
    </span>
  );
}

export function VolumeControl() {
  useLocale();
  const s = useServices();
  const { volume } = useStore(s.preferences);
  const muted = volume === 0;
  return (
    <>
      <IconButton
        icon={muted ? "volume-muted" : "volume"}
        label={muted ? tr("取消静音") : tr("静音")}
        aria-pressed={muted}
        onClick={() => s.toggleMute()}
      />
      <VolumeSlider label={tr("音量")} />
    </>
  );
}
