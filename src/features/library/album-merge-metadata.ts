import { mergeScrapedTitles } from "../../api/localized-titles";
import type { MusicTrack } from "../../api/music-catalog";
import { trackMetadataDraft, type TrackMetadataDraft } from "./track-metadata-draft";

// 主曲目的标量优先，其余曲目补齐空值。旧曲名与署名按主曲目优先的顺序合并。
export function albumMergeDefaults(tracks: MusicTrack[], target: MusicTrack, editedTitle?: string): TrackMetadataDraft {
  const draft = trackMetadataDraft(target);
  const ordered = [target, ...tracks.filter(track => track.trackId !== target.trackId)];
  draft.artistNames = [...new Set(ordered.flatMap(track => track.artists.map(artist => artist.name)))].join("\n");
  draft.localizedTitles = [];
  for (const track of ordered) {
    draft.localizedTitles = mergeScrapedTitles(editedTitle ?? target.title, draft.localizedTitles, track);
    draft.genre ||= track.genre ?? "";
    draft.year ||= track.year?.toString() ?? "";
    draft.rating ||= track.rating?.toString() ?? "";
    draft.coverPath ||= track.coverPath ?? "";
  }
  return draft;
}
