import type { SourceTrack } from "../api/types";
import { ApiError } from "../api/client";
import { useServices } from "../app/services";
import { useResource } from "../components/query";
export function useCatalog() {
  const s = useServices();
  return useResource("catalog", async (signal) => {
    const tracks: SourceTrack[] = [];
    let cursor: string | null = null;
    let revision: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await s.libraryApi.page("all", cursor, signal);
      if (revision && revision !== page.libraryRevision)
        throw new ApiError("CURSOR_EXPIRED", "Catalog changed");
      revision = page.libraryRevision;
      tracks.push(...page.items);
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor))
        throw new ApiError("PAGINATION_STALLED", "Catalog stalled");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return [...new Map(tracks.map((t) => [t.sourceTrackId, t])).values()];
  });
}
