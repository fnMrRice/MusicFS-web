import { tr } from "../../i18n";

const labels: Record<string, string> = {
  lyrics: "歌词", artwork: "专辑封面", albumDetails: "专辑详情", albumTracks: "专辑曲目",
  artistDetails: "歌手资料", artistImage: "歌手图像", recordingIdentity: "录音识别",
  trackDetails: "曲目资料", workDetails: "作品资料",
};

export function scrapedFieldName(field: string) {
  return Object.hasOwn(labels, field) ? tr(labels[field]) : field;
}

const platforms: Record<string, string> = {
  "musicfs.scraper.musicbrainz": "MusicBrainz",
  "musicfs.scraper.itunes": "Apple Music (iTunes)",
  "musicfs.scraper.netease": "网易云音乐",
  "musicfs.scraper.qqmusic": "QQ 音乐",
  "musicfs.scraper.local": "本地歌词",
  "musicfs.scraper.lrclib": "LRCLIB",
  "musicfs.scraper.bangumi": "Bangumi",
};

export function scraperName(pluginId: string, descriptorName?: string) {
  return tr(platforms[pluginId] ?? descriptorName ?? pluginId);
}

export function externalLink(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
