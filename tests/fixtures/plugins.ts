import type { PluginIdentity } from "../../src/api/types";

export const instanceIds = {
  local: "4a7497f8-0908-423e-b593-d1c29c9de303",
  ffmpeg: "b8c97071-f7ab-4311-9bb1-b787a11cbf1f",
  ncm: "b5998171-65e8-4a7e-b572-0c9829f79651",
  scraper: "c17368a1-5210-47c6-84bb-f647943d6ee1",
  netease: "ab4dfbab-e2fc-49ef-a706-b7c9f6330965",
  neteaseSecond: "87d29d7b-8f93-412b-9c5d-a0984118ec2a",
  qqmusic: "091a4806-fd02-4427-bd98-5f74aca6a8b7",
  applemusic: "d320e491-170a-4697-a624-cfb9f29c6c68",
  custom: "9a146fb5-7339-424b-ad43-f66d49321ec0",
  customFolder: "ce27b7ae-451b-45a6-a126-fb104f70c6f6",
  unknown: "dd3bd781-0224-42aa-a45d-265d46a53983",
} as const;

export const localPlugin: PluginIdentity = {
  id: "musicfs.plugin.source.localfiles", name: "Local Music",
  localizedNames: { "zh-CN": "本地音乐", "zh-TW": "本地音樂" }, features: ["music-source"],
};
export const neteasePlugin: PluginIdentity = {
  id: "musicfs.plugin.source.netease", name: "NetEase Cloud Music",
  localizedNames: { "zh-CN": "网易云音乐", "zh-TW": "網易雲音樂" }, features: ["music-source"],
};
export const ncmPlugin: PluginIdentity = {
  id: "musicfs.plugin.decoder.ncm", name: "NCM Decoder",
  localizedNames: { "zh-CN": "NCM 解密", "zh-TW": "NCM 解密" }, features: ["audio-codec"],
};
export const scraperPlugin: PluginIdentity = {
  id: "musicfs.scraper.local", name: "Local Metadata",
  localizedNames: { "zh-CN": "本地元数据提取", "zh-TW": "本地中繼資料擷取" }, features: ["metadata"],
};
