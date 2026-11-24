import type { DownloadVersion } from "../../api/types";
import { tr } from "../../i18n";
import { formatPair, versionParameters } from "../../player/format";

const qualityNames: Record<string, string> = {
  standard: "标准", higher: "较高", exhigh: "极高", lossless: "无损", hires: "高解析度无损",
  jyeffect: "高清臻音", jymaster: "超清母带", sky: "沉浸环绕声",
};

export function qualityLabel(version: DownloadVersion): string {
  return Object.hasOwn(qualityNames, version.quality) ? tr(qualityNames[version.quality]) : version.quality;
}

export function versionLabel(version: DownloadVersion): string {
  return [qualityLabel(version), formatPair(version.container, version.codec) ?? version.mime,
    versionParameters(version), !version.formatMeasured && tr("来源标注")].filter(Boolean).join(" · ");
}
