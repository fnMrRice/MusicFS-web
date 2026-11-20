import type { MusicTrack, MusicTrackPage } from "../../src/api/music-catalog";
import type { SourceTrack } from "../../src/api/types";

export function musicTrack(source: SourceTrack): MusicTrack {
  return {
    trackId: source.recordingId || source.sourceTrackId, title: source.title || source.displayName, revision: 1,
    artists: (source.artists || []).map((name) => ({ artistId: name, name })),
    albums: source.album ? [{ albumId: source.album, name: source.album }] : [],
    coverPath: null, genre: source.genre ?? null, year: null, rating: null,
    selectedSource: { ...source, versions: source.versions ?? [source] },
  };
}

export function musicPage(items: SourceTrack[], libraryRevision = "1", matchingRevision = 0, nextAfter: string | null = null): MusicTrackPage {
  return { items: items.map(musicTrack), libraryRevision, matchingRevision, nextAfter };
}
