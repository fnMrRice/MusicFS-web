import type { AccountPlaylistPage, OnlineInstance } from "../api/content";
import { ApiError } from "../api/client";
import { Store } from "./store";

/** Account lists are scoped to one Services session, with independent request lifetimes. */
export class SourcePlaylistCatalog {
  readonly pages = new Store<Record<string, AccountPlaylistPage>>({});
  readonly revisions = new Store<Record<string, number>>({});
  private sources = new Map<string, string>();
  private epoch = 0;
  private blocked = new Set<string>();
  private requests = new Map<string, { controller: AbortController; promise: Promise<AccountPlaylistPage> }>();
  constructor(private load: (instance: string, signal: AbortSignal) => Promise<AccountPlaylistPage>) {}

  update(instances: readonly OnlineInstance[]): void {
    const eligible = new Map(instances.filter((instance) =>
      instance.availability === "available" &&
      (!instance.plugin || instance.plugin.features?.includes("music-source")) &&
      instance.capabilities.some((capability) => capability.name === "playlist.list" && capability.supported),
    ).map((instance) => [instance.instanceId, JSON.stringify([instance.accountId ?? "", instance.accountRevision ?? "", instance.plugin?.id ?? ""])]));
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
    this.blocked.add(instance);
    const pages = { ...this.pages.value };
    delete pages[instance];
    this.pages.set(pages);
    this.revisions.set({ ...this.revisions.value, [instance]: (this.revisions.value[instance] ?? 0) + 1 });
  }

  refresh(instance: string): void {
    this.invalidate(instance);
    this.blocked.delete(instance);
    if (!this.sources.has(instance)) return;
    const controller = new AbortController();
    const generation = this.generation(instance);
    const promise = this.loadFirst(instance, controller.signal).then((page) => {
      if (controller.signal.aborted || generation !== this.generation(instance))
        throw new ApiError("CANCELLED", "Account changed");
      this.accept(instance, page, generation);
      return page;
    }).finally(() => {
      if (this.requests.get(instance)?.controller === controller) this.requests.delete(instance);
    });
    const request = { controller, promise };
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

  private async loadFirst(instance: string, signal: AbortSignal): Promise<AccountPlaylistPage> {
    for (let attempt = 0; ; ++attempt) {
      try { return await this.load(instance, signal); }
      catch (error) {
        if (!(error instanceof ApiError) || error.code !== "RATE_LIMITED" || attempt >= 2 ||
          signal.aborted || (error.retryAfter ?? 1) > 10) throw error;
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { clearTimeout(timer); reject(new ApiError("CANCELLED", "Request cancelled")); };
          const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, Math.max(error.retryAfter ?? 1, 1) * 1000);
          signal.addEventListener("abort", cancel, { once: true });
          if (signal.aborted) cancel();
        });
      }
    }
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
    this.blocked.clear();
    this.pages.set({});
    this.revisions.set({});
  }
}
