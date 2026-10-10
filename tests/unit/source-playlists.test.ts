import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountPlaylistPage, OnlineInstance } from "../../src/api/content";
import { ApiError } from "../../src/api/client";
import { SourcePlaylistCatalog } from "../../src/app/source-playlists";

const instance: OnlineInstance = {
  instanceId: "private", accountId: "account-a", name: "Private alias", platform: "custom", availability: "available",
  plugin: { id: "example.radio", name: "Example", localizedNames: {}, features: ["music-source"] },
  capabilities: [{ name: "playlist.list", supported: true, reason: "Supported" }],
};
const page: AccountPlaylistPage = { items: [{ externalId: "one", title: "First", sourceUrl: "", trackCount: 2 }], nextCursor: null, consistency: "unversioned", observedAt: "2026-10-10T08:00:00Z" };

describe("Source playlist navigation categories", () => {
  afterEach(() => vi.useRealTimers());

  it("shows only successful nonempty lists and shares the first request with the page", async () => {
    let finish!: (value: AccountPlaylistPage) => void;
    const load = vi.fn(() => new Promise<AccountPlaylistPage>((resolve) => { finish = resolve; }));
    const catalog = new SourcePlaylistCatalog(load);
    catalog.update([instance]);
    const first = catalog.first(instance.instanceId);
    expect(catalog.pages.value).toEqual({});
    expect(load).toHaveBeenCalledOnce();
    finish(page);
    await first;
    expect(catalog.pages.value.private.items).toHaveLength(1);
    expect(await catalog.first("private")).toEqual(page);
    expect(load).toHaveBeenCalledOnce();
    catalog.accept("private", { ...page, items: [] }, catalog.generation("private"));
    expect(catalog.pages.value.private.items).toHaveLength(0);
    catalog.failed("private", catalog.generation("private"));
    expect(catalog.pages.value).toEqual({});
  });

  it("does not probe unsupported, offline, or signed-out sources", () => {
    const load = vi.fn().mockResolvedValue(page);
    const catalog = new SourcePlaylistCatalog(load);
    catalog.update([
      { ...instance, availability: "offline" },
      { ...instance, instanceId: "signed-out", availability: "loginRequired" },
      { ...instance, instanceId: "unsupported", capabilities: [] },
      { ...instance, instanceId: "decoder", plugin: { ...instance.plugin!, features: ["decode"] } },
    ]);
    expect(load).not.toHaveBeenCalled();
    expect(catalog.pages.value).toEqual({});
  });

  it("discards late results after logout, account replacement and server-session replacement", async () => {
    const complete: ((value: AccountPlaylistPage) => void)[] = [];
    const load = vi.fn(() => new Promise<AccountPlaylistPage>((resolve) => { complete.push(resolve); }));
    const catalog = new SourcePlaylistCatalog(load);
    catalog.update([instance]);
    const old = catalog.first("private");
    const oldGeneration = catalog.generation("private");
    catalog.invalidate("private");
    expect(catalog.pages.value).toEqual({});
    catalog.update([{ ...instance, accountId: "account-b" }]);
    complete[0](page);
    await expect(old).rejects.toMatchObject({ code: "CANCELLED" });
    catalog.accept("private", page, oldGeneration);
    expect(catalog.pages.value).toEqual({});
    const newer = catalog.first("private");
    catalog.clear();
    catalog.update([instance]);
    complete[1](page);
    await expect(newer).rejects.toMatchObject({ code: "CANCELLED" });
    expect(catalog.pages.value).toEqual({});
    complete[2]({ ...page, items: [] });
    await catalog.first("private");
    expect(catalog.pages.value.private.items).toEqual([]);
    catalog.clear();
  });

  it("retries rate limits at most twice and permits a later source refresh after failure", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockRejectedValueOnce(new ApiError("RATE_LIMITED", "Rate limited", 429, undefined, 2))
      .mockResolvedValueOnce(page);
    const catalog = new SourcePlaylistCatalog(load);
    catalog.update([instance]);
    const first = catalog.first("private");
    await vi.advanceTimersByTimeAsync(1999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(catalog.pages.value.private.items).toHaveLength(1);
    load.mockRejectedValue(new ApiError("RATE_LIMITED", "Rate limited", 429));
    catalog.refresh("private");
    const failure = expect(catalog.first("private")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await vi.advanceTimersByTimeAsync(3000);
    await failure;
    expect(load).toHaveBeenCalledTimes(5);
    expect(catalog.pages.value).toEqual({});
    load.mockResolvedValue(page);
    catalog.update([instance]);
    await catalog.first("private");
    expect(catalog.pages.value.private.items).toHaveLength(1);
  });

  it("invalidates the same account when its authorization revision changes", async () => {
    const complete: ((value: AccountPlaylistPage) => void)[] = [];
    const load = vi.fn(() => new Promise<AccountPlaylistPage>((resolve) => { complete.push(resolve); }));
    const catalog = new SourcePlaylistCatalog(load);
    catalog.update([{ ...instance, accountRevision: "revision-a" }]);
    complete[0](page);
    await catalog.first("private");
    expect(catalog.pages.value.private.items).toHaveLength(1);
    catalog.refresh("private");
    const stale = catalog.first("private");
    const oldGeneration = catalog.generation("private");
    catalog.update([{ ...instance, accountRevision: "revision-b" }]);
    expect(catalog.pages.value).toEqual({});
    expect(load).toHaveBeenCalledTimes(3);
    complete[1](page);
    await expect(stale).rejects.toMatchObject({ code: "CANCELLED" });
    catalog.accept("private", page, oldGeneration);
    expect(catalog.pages.value).toEqual({});
    complete[2]({ ...page, items: [] });
    await catalog.first("private");
    expect(catalog.pages.value.private.items).toEqual([]);
  });
});
