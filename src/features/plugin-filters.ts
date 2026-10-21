import type { PluginSnapshot } from "../api/directories";
import { tr } from "../i18n";

type Plugin = PluginSnapshot["items"][number];

const purposeLabels: Record<string, string> = {
  "music-source": "音乐源",
  "audio-processing": "音频处理",
  "audio-dsp": "DSP",
  "audio-analysis": "音频分析",
  "tag-format": "标签格式",
  matching: "录音匹配",
  "content-transform": "内容变换",
  database: "数据库",
  "audio-decryption": "音频解密",
  lyrics: "歌词",
  artwork: "封面",
  decode: "音频解码",
  scraper: "元数据刮削",
};

export function pluginPurposes(plugin: Plugin): string[] {
  const features = plugin.plugin?.features ?? [];
  return features.length ? [...new Set(features)] : [""];
}

export function pluginPurposeLabel(purpose: string): string {
  if (!purpose) return tr("未分类");
  return Object.hasOwn(purposeLabels, purpose) ? tr(purposeLabels[purpose]) : purpose;
}

export function matchesPlugin(plugin: Plugin, purposes: ReadonlySet<string>, query: string): boolean {
  if (purposes.size && !pluginPurposes(plugin).some((purpose) => purposes.has(purpose))) return false;
  const search = query.trim().toLowerCase();
  if (!search) return true;
  const names = [plugin.pluginId, plugin.plugin?.name, ...Object.values(plugin.plugin?.localizedNames ?? {})];
  return names.some((name) => name?.toLowerCase().includes(search));
}
