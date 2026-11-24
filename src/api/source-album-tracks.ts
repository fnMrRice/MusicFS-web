import { ApiError } from "./client";
import type { Album } from "./content";
import type { LibraryApi } from "./library";
import type { SourceTrack } from "./types";

export async function sourceAlbumTracks(library: LibraryApi, album: Album, signal: AbortSignal): Promise<SourceTrack[]> {
  const remaining = new Set(album.sourceTrackIds);
  const found = new Map<string, SourceTrack>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let revision: string | null = null;
  while (remaining.size) {
    const page = await library.page(album.providerInstanceId, cursor, signal);
    if (revision !== null && revision !== page.libraryRevision)
      throw new ApiError("CURSOR_EXPIRED", "Catalog changed");
    revision = page.libraryRevision;
    for (const track of page.items) {
      if (remaining.delete(track.sourceTrackId)) found.set(track.sourceTrackId, track);
    }
    cursor = page.nextCursor;
    if (!cursor || !remaining.size) break;
    if (cursors.has(cursor)) throw new ApiError("PAGINATION_STALLED", "Catalog stalled");
    cursors.add(cursor);
  }
  return album.sourceTrackIds.flatMap(id => {
    const track = found.get(id);
    return track ? [track] : [];
  });
}
