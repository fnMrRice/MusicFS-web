import type { SourceTrack } from "../../api/types";
import { formatDate, tr } from "../../i18n";

const qualityNames: Record<string, string> = {
  standard: "标准", exhigh: "极高", lossless: "无损", hires: "高解析度无损",
  jyeffect: "高清臻音", jymaster: "超清母带", sky: "沉浸环绕声",
};

export function SourceDownloads({ track }: { track: SourceTrack }) {
  if (!track.downloaded) return null;
  const versions = track.downloadVersions ?? [];
  if (versions.length === 0) return <small className="muted">{tr("已下载")}</small>;
  return <details className="source-downloads">
    <summary>{tr("已下载 · {0} 个版本", { 0: versions.length })}</summary>
    <ul>{versions.map(version => <li key={version.versionId}>
      {[Object.hasOwn(qualityNames, version.quality) ? tr(qualityNames[version.quality]) : version.quality,
        (version.codec || version.container || version.mime).toUpperCase(),
        version.bitrateBps && `${Math.round(version.bitrateBps / 1000)} kbps`,
        `${(version.sizeBytes / 1048576).toFixed(2)} MiB`, formatDate(version.downloadedAt),
      ].filter(Boolean).join(" · ")}
    </li>)}</ul>
  </details>;
}
