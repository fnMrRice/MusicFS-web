import { ApiError, errorMessage } from "../api/client";
import { CursorPages } from "../api/cursor-pages";
import type { MusicTrack, MusicTrackPage } from "../api/music-catalog";

export interface LibrarySnapshot {
  items: MusicTrack[];
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
) => Promise<MusicTrackPage>;
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
  private pages: CursorPages<MusicTrack> | null = null;
  constructor(private load: PageLoader, private received?: (items: MusicTrack[]) => void) {}
  select(provider: string): Promise<void> {
    if (provider !== this.provider) {
      this.provider = provider;
      this.pages = null;
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
    this.pages = null;
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
      const pages = (append ? this.pages : null) ?? new CursorPages<MusicTrack>((item) => item.trackId);
      // 主曲库从续页开始累计连续无新增曲目的次数。
      const items = pages.merge(page.items, cursor, page.nextAfter, append);
      this.pages = page.nextAfter ? pages : null;
      this.snapshot = {
        items,
        revision: page.libraryRevision,
        matchingRevision: page.matchingRevision,
        cursor: page.nextAfter,
        loading: false,
        stale: false,
        error: null,
      };
      this.received?.(page.items);
    } catch (error) {
      if (generation !== this.generation) return;
      const expired =
        error instanceof ApiError && error.code === "CURSOR_EXPIRED";
      if (expired) this.pages = null;
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
