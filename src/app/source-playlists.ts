import type { AccountPlaylistPage, OnlineInstance } from "../api/content";
import { ApiError, errorMessage } from "../api/client";
import { withRateLimitRetry } from "../api/rate-limit";
import { Store } from "./store";

export const supportsAccountPlaylists = (instance: OnlineInstance) =>
  instance.availability === "available" &&
  (!instance.plugin || instance.plugin.features?.includes("music-source")) &&
  instance.capabilities.some((capability) => capability.name === "playlist.list" && capability.supported);

/** 侧栏、歌单管理和来源浏览共享当前账号的分页结果和请求。 */
export class SourcePlaylistCatalog {
  readonly pages = new Store<Record<string, AccountPlaylistPage>>({});
  readonly status = new Store<Record<string, { loading: boolean; error: string | null }>>({});
  readonly revisions = new Store<Record<string, number>>({});
  private sources = new Map<string, string>();
  private epoch = 0;
  private blocked = new Set<string>();
  private requests = new Map<string, { controller: AbortController; cursor: string | null; promise: Promise<AccountPlaylistPage> }>();
  private cursors = new Map<string, Set<string>>();
  private firstPages = new Map<string, AccountPlaylistPage>();
  constructor(private load: (instance: string, signal: AbortSignal, cursor: string | null, refresh: boolean) => Promise<AccountPlaylistPage>) {}

  update(instances: readonly OnlineInstance[]): void {
    const eligible = new Map(instances.filter(supportsAccountPlaylists)
      .map((instance) => [instance.instanceId, JSON.stringify([instance.accountId ?? "", instance.accountRevision ?? "", instance.plugin?.id ?? ""])]));
    for (const id of this.sources.keys()) {
      if (!eligible.has(id)) {
        this.invalidate(id);
        this.blocked.delete(id);
      }
    }
    const added = [...eligible].filter(([id, identity]) => this.sources.get(id) !== identity).map(([id]) => id);
    this.sources = eligible;
    for (const id of added) this.refresh(id);
    for (const id of eligible.keys())
      if (!added.includes(id) && !this.pages.value[id] && !this.requests.has(id) && !this.blocked.has(id)) this.refresh(id);
  }

  generation(instance: string): string {
    return `${this.epoch}:${this.revisions.value[instance] ?? 0}`;
  }

  invalidate(instance: string): void {
    this.requests.get(instance)?.controller.abort();
    this.requests.delete(instance);
    this.cursors.delete(instance);
    this.firstPages.delete(instance);
    this.blocked.add(instance);
    const pages = { ...this.pages.value };
    delete pages[instance];
    this.pages.set(pages);
    const status = { ...this.status.value };
    delete status[instance];
    this.status.set(status);
    this.revisions.set({ ...this.revisions.value, [instance]: (this.revisions.value[instance] ?? 0) + 1 });
  }

  refresh(instance: string, force = false): void {
    this.invalidate(instance);
    this.blocked.delete(instance);
    if (!this.sources.has(instance)) return;
    this.fetch(instance, null, force);
  }

  revalidate(instance: string): void {
    if (!this.sources.has(instance) || this.blocked.has(instance)) return;
    const pending = this.requests.get(instance);
    if (!pending) this.fetch(instance, null);
    else if (pending.cursor) {
      // 保留进行中的翻页，结束后再向 Server 确认当前首屏。
      void pending.promise.finally(() => {
        if (!pending.controller.signal.aborted) this.revalidate(instance);
      }).catch(() => {});
    }
  }

  more(instance: string): void {
    const cursor = this.pages.value[instance]?.nextCursor;
    if (cursor && !this.requests.has(instance)) this.fetch(instance, cursor);
  }

  private fetch(instance: string, cursor: string | null, force = false): void {
    const controller = new AbortController();
    const generation = this.generation(instance);
    this.status.set({ ...this.status.value, [instance]: { loading: true, error: null } });
    const promise = withRateLimitRetry(() => this.load(instance, controller.signal, cursor, force), controller.signal).then((page) => {
      if (controller.signal.aborted || generation !== this.generation(instance))
        throw new ApiError("CANCELLED", "Account changed");
      if (!cursor) {
        const current = this.pages.value[instance];
        // Server 返回相同首屏时继续使用已经加载的后续页。
        if (current && JSON.stringify(this.firstPages.get(instance)) === JSON.stringify(page)) {
          this.status.set({ ...this.status.value, [instance]: { loading: false, error: null } });
          return current;
        }
        this.firstPages.set(instance, page);
        this.cursors.delete(instance);
      }
      const seen = this.cursors.get(instance) ?? new Set<string>();
      if (cursor) seen.add(cursor);
      if (page.nextCursor && seen.has(page.nextCursor))
        throw new ApiError("PAGINATION_STALLED", "Playlist pagination stalled");
      this.cursors.set(instance, seen);
      const previous = cursor ? this.pages.value[instance].items : [];
      const items = new Map(previous.map((item) => [item.externalId, item]));
      for (const item of page.items) items.set(item.externalId, item);
      const combined = { ...page, items: [...items.values()] };
      this.accept(instance, combined, generation);
      this.status.set({ ...this.status.value, [instance]: { loading: false, error: null } });
      return combined;
    }).catch((error) => {
      if (!controller.signal.aborted && generation === this.generation(instance)) {
        if (!cursor) this.failed(instance, generation);
        this.status.set({ ...this.status.value, [instance]: { loading: false, error: errorMessage(error) } });
      }
      throw error;
    }).finally(() => {
      if (this.requests.get(instance)?.controller === controller) this.requests.delete(instance);
    });
    const request = { controller, cursor, promise };
    this.requests.set(instance, request);
    void promise.catch(() => {});
  }

  first(instance: string): Promise<AccountPlaylistPage> {
    if (!this.sources.has(instance) || this.blocked.has(instance))
      return Promise.reject(new ApiError("PLATFORM_AUTH_REQUIRED", "Account unavailable"));
    if (this.pages.value[instance]) return Promise.resolve(this.pages.value[instance]);
    if (!this.requests.has(instance)) this.refresh(instance);
    return this.requests.get(instance)!.promise;
  }

  accept(instance: string, page: AccountPlaylistPage, generation: string): void {
    if (!this.sources.has(instance) || this.blocked.has(instance) || generation !== this.generation(instance)) return;
    this.pages.set({ ...this.pages.value, [instance]: page });
  }

  failed(instance: string, generation: string): void {
    if (generation !== this.generation(instance)) return;
    const pages = { ...this.pages.value };
    delete pages[instance];
    this.pages.set(pages);
  }

  clear(): void {
    ++this.epoch;
    this.requests.forEach((request) => request.controller.abort());
    this.requests.clear();
    this.sources.clear();
    this.cursors.clear();
    this.firstPages.clear();
    this.blocked.clear();
    this.pages.set({});
    this.status.set({});
    this.revisions.set({});
  }
}
