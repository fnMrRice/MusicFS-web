import type { SourceTrack } from "../../api/types";
import { tr } from "../../i18n";
import { bitrateLabel, formatPair, sampleRateLabel, versionParameters } from "../../player/format";
import { versionLabel } from "./download-format";
import { useSourceDownloads } from "./use-source-downloads";

export function TrackAudioFormat({ track, detailed = false }: { track: SourceTrack; detailed?: boolean }) {
  const { versions } = useSourceDownloads(track);
  const formats = versions.filter(v => v.formatMeasured).map(v => formatPair(v.container, v.codec)).filter(Boolean);
  const format = [...new Set(formats)].join(" / ") || (track.container || track.codec)?.toUpperCase() || "—";
  const saved = versions.length === 1 && versions[0].formatMeasured ? versions[0] : undefined;
  const size = saved?.sizeBytes ?? track.asset?.fileSizeBytes;
  const parameters = saved ? versionParameters(saved) : [sampleRateLabel(track.sampleRateHz), bitrateLabel(track.bitrateBps)].join(" · ");
  return <>
    <span className="format" title={versions.length ? versions.map(versionLabel).join("\n") : undefined}>{format}</span>
    {detailed && versions.length < 2 && <span className="track-version-quality"
      title={tr("文件大小：{0}", { 0: validSize(size) ? `${size} B` : tr("大小未知") })}>
      {[parameters, fileSize(size)].filter(Boolean).join(" · ")}
    </span>}
  </>;
}

function validSize(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function fileSize(value: number | null | undefined): string {
  if (!validSize(value)) return tr("大小未知");
  if (value < 1024) return `${value} B`;
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(2)} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}
