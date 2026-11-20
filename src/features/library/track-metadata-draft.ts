import { validLocalizedNames, type LocalizedTitle } from "../../api/localized-titles";
import type { MusicTrack, TrackMetadata } from "../../api/music-catalog";

export interface TrackMetadataDraft {
  title: string;
  localizedTitles: LocalizedTitle[];
  artistNames: string;
  genre: string;
  year: string;
  rating: string;
  coverPath: string;
}

export const trackMetadataLabels = {
  title: "曲名", localizedTitles: "多语言曲名", artistNames: "歌手",
  genre: "音乐风格", year: "年份", rating: "评分", coverPath: "封面路径",
} as const satisfies Record<keyof TrackMetadataDraft, string>;

export function trackMetadataDraft(track: MusicTrack): TrackMetadataDraft {
  return {
    title: track.title, localizedTitles: track.localizedTitles ?? [],
    artistNames: track.artists.map(artist => artist.name).join("\n"),
    genre: track.genre ?? "", year: track.year?.toString() ?? "",
    rating: track.rating?.toString() ?? "", coverPath: track.coverPath ?? "",
  };
}

export function toTrackMetadata(draft: TrackMetadataDraft): TrackMetadata {
  return {
    title: draft.title.trim(),
    localizedTitles: draft.localizedTitles.map(({ language, title }) => ({ language: language.trim(), title: title.trim() })),
    artistNames: draft.artistNames.split("\n").map(name => name.trim()).filter(Boolean),
    genre: draft.genre.trim() || null, year: draft.year.trim() ? Number(draft.year) : null,
    rating: draft.rating ? Number(draft.rating) : null, coverPath: draft.coverPath.trim() || null,
  };
}

export function trackMetadataErrors(draft: TrackMetadataDraft): Partial<Record<keyof TrackMetadataDraft, string>> {
  const value = toTrackMetadata(draft);
  const errors: Partial<Record<keyof TrackMetadataDraft, string>> = {};
  const validLine = (text: string, limit: number) => [...text].length <= limit && !/\p{Cc}/u.test(text);
  if (!value.title || !validLine(value.title, 256)) errors.title = "请输入不超过 256 个字符的单行曲名。";
  if (!validLocalizedNames(value.localizedTitles)) errors.localizedTitles = "请填写有效的语言标签和名称，同一语言下的名称不能重复。";
  if (value.artistNames.length > 128 || value.artistNames.some(name => !validLine(name, 256)) ||
      new Set(value.artistNames).size !== value.artistNames.length) errors.artistNames = "最多可填写 128 位歌手，每个名称最多 256 个字符，且不能重复。";
  if (value.genre && !validLine(value.genre, 128)) errors.genre = "音乐风格最多 128 个字符。";
  if (value.year !== null && (!/^\d+$/.test(draft.year.trim()) || value.year < 1 || value.year > 9999))
    errors.year = "请输入 1 到 9999 之间的整数年份。";
  if (value.rating !== null && !/^[1-5]$/.test(draft.rating)) errors.rating = "评分范围为 1 至 5。";
  if (value.coverPath && !validLine(value.coverPath, 4096)) errors.coverPath = "封面路径最多 4096 个字符。";
  return errors;
}

export const validTrackMetadata = (draft: TrackMetadataDraft) => !Object.keys(trackMetadataErrors(draft)).length;
