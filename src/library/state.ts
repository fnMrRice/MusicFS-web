import { ApiError, errorMessage } from "../api/client";
import type { SourceTrack, TrackPage } from "../api/types";

export interface LibrarySnapshot {
  items: SourceTrack[];
  revision: string | null;
  matchingRevision?: number;
  cursor: string | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
}
type PageLoader = (
  provider: string,
  cursor: string | null,
  signal: AbortSignal,
) => Promise<TrackPage>;
export class LibraryState {
  snapshot: LibrarySnapshot = {
    items: [],
    revision: null,
    cursor: null,
    loading: false,
    stale: false,
    error: null,
  };
  onChange: (() => void) | null = null;
  private generation = 0;
  private controller: AbortController | null = null;
  private provider = "";
  private emptyPages = 0;
  private consumed = new Set<string>();
  constructor(private load: PageLoader) {}
  select(provider: string): Promise<void> {
    if (provider !== this.provider) {
      this.provider = provider;
      this.snapshot = {
        items: [],
        revision: null,
        cursor: null,
        loading: false,
        stale: false,
        error: null,
      };
    }
    return this.refresh();
  }
  refresh(): Promise<void> {
    return this.request(false);
  }
  more(): Promise<void> {
    return this.snapshot.loading || !this.snapshot.cursor
      ? Promise.resolve()
      : this.request(true);
  }
  clear(): void {
    ++this.generation;
    this.controller?.abort();
    this.provider = "";
    this.snapshot = {
      items: [],
      revision: null,
      cursor: null,
      loading: false,
      stale: false,
      error: null,
    };
    this.onChange?.();
  }
  cancel(): void {
    ++this.generation;
    this.controller?.abort();
    this.snapshot = { ...this.snapshot, loading: false };
    this.onChange?.();
  }
  private async request(append: boolean): Promise<void> {
    if (!this.provider) return;
    if (!append) {
      this.emptyPages = 0;
      this.consumed.clear();
    }
    const generation = ++this.generation;
    this.controller?.abort();
    this.controller = new AbortController();
    const cursor = append ? this.snapshot.cursor : null;
    this.snapshot = { ...this.snapshot, loading: true, error: null };
    this.onChange?.();
    try {
      const page = await this.load(
        this.provider,
        cursor,
        this.controller.signal,
      );
      if (generation !== this.generation) return;
      if (append && (page.libraryRevision !== this.snapshot.revision || page.matchingRevision !== this.snapshot.matchingRevision))
        throw new ApiError("CURSOR_EXPIRED", "Revision changed");
      const added = page.items.filter(
        (item) =>
          !this.snapshot.items.some(
            (old) => old.sourceTrackId === item.sourceTrackId,
          ),
      );
      this.emptyPages = append && !added.length ? this.emptyPages + 1 : 0;
      if (
        page.nextCursor &&
        (page.nextCursor === cursor ||
          this.consumed.has(page.nextCursor) ||
          this.emptyPages >= 3)
      )
        throw new ApiError("PAGINATION_STALLED", "Pagination did not advance");
      if (cursor) this.consumed.add(cursor);
      const items = append
        ? [...this.snapshot.items, ...page.items]
        : page.items;
      this.snapshot = {
        items: [
          ...new Map(items.map((item) => [item.sourceTrackId, item])).values(),
        ],
        revision: page.libraryRevision,
        matchingRevision: page.matchingRevision,
        cursor: page.nextCursor,
        loading: false,
        stale: false,
        error: null,
      };
    } catch (error) {
      if (generation !== this.generation) return;
      const expired =
        error instanceof ApiError && error.code === "CURSOR_EXPIRED";
      this.snapshot = {
        ...this.snapshot,
        loading: false,
        stale: this.snapshot.items.length > 0,
        cursor: expired ? null : this.snapshot.cursor,
        error: errorMessage(error),
      };
    }
    this.onChange?.();
  }
}
