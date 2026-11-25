import { ApiError, errorMessage } from "../api/client";
import { CursorPages } from "../api/cursor-pages";
import type { CatalogPage } from "../api/categories";

interface CatalogSnapshot<T> {
  items: T[]; total: number | null; cursor: string | null; revision: string | null;
  loading: boolean; error: string | null;
}
type Loader<T> = (cursor: string | null, signal: AbortSignal) => Promise<CatalogPage<T>>;

// 每个状态只拥有一个查询；切换范围和离开页面时释放服务端快照。
export class CatalogState<T> {
  snapshot: CatalogSnapshot<T> = { items: [], total: null, cursor: null, revision: null, loading: true, error: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private queryId: string | null = null;
  private released = new Set<string>();
  private pages: CursorPages<T> | null = null;
  constructor(private load: Loader<T>, private identity: (item: T) => string, private release: (id: string) => Promise<void>) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  refresh = (): Promise<void> => this.request(false);
  more = (): Promise<void> => this.snapshot.loading || !this.snapshot.cursor ? Promise.resolve() : this.request(true);
  retry = (): Promise<void> => this.snapshot.cursor ? this.more() : this.refresh();
  dispose = (): void => {
    ++this.generation;
    this.controller?.abort();
    this.releaseQuery(this.queryId);
    this.queryId = null;
    this.pages = null;
  };
  private releaseQuery(id: string | null) {
    if (!id || this.released.has(id)) return;
    this.released.add(id);
    void this.release(id).catch(() => { this.released.delete(id); });
  }
  private update(value: CatalogSnapshot<T>) { this.snapshot = value; this.listeners.forEach((listener) => listener()); }
  private async request(append: boolean): Promise<void> {
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const before = this.snapshot;
    const cursor = append ? before.cursor : null;
    if (!append) {
      this.releaseQuery(this.queryId);
      this.queryId = null;
      this.pages = null;
    }
    this.update(append ? { ...before, loading: true, error: null } :
      { items: [], total: null, cursor: null, revision: null, loading: true, error: null });
    try {
      const page = await this.load(cursor, controller.signal);
      if (generation !== this.generation) { this.releaseQuery(page.queryId); return; }
      if (append && (page.queryId !== this.queryId || page.catalogRevision !== before.revision || page.total !== before.total)) {
        this.releaseQuery(page.queryId);
        throw new ApiError("CURSOR_EXPIRED", "Catalog revision changed");
      }
      this.queryId = page.queryId;
      const pages = this.pages ?? new CursorPages(this.identity);
      const items = pages.merge(page.items, cursor, page.nextCursor);
      this.pages = page.nextCursor ? pages : null;
      this.update({ items, total: page.total, cursor: page.nextCursor, revision: page.catalogRevision, loading: false, error: null });
      if (!page.nextCursor) this.releaseQuery(page.queryId);
    } catch (error) {
      if (generation !== this.generation) return;
      const expired = error instanceof ApiError && error.code === "CURSOR_EXPIRED";
      if (expired) {
        this.pages = null;
        this.releaseQuery(this.queryId);
      }
      this.update({ ...this.snapshot, loading: false, cursor: expired ? null : this.snapshot.cursor, error: errorMessage(error) });
    }
  }
}
