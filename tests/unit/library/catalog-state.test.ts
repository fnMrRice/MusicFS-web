import { describe, expect, it, vi } from "vitest";
import type { CatalogPage } from "../../../src/api/categories";
import { CatalogState } from "../../../src/library/catalog-state";
import { ApiError } from "../../../src/api/client";
import { deferred } from "../../fixtures/dto";

type Item = { id: string };
const page = (ids: string[], nextCursor: string | null = null, overrides = {}): CatalogPage<Item> => ({ queryId: "query", query: {},
  catalogRevision: "revision", expiresAt: "2026-10-22T12:00:00Z", total: 3, items: ids.map((id) => ({ id })), nextCursor, ...overrides });
const release = () => vi.fn(async (_id: string) => {});

describe("Catalog query ownership and paging", () => {
  it("reads only incoming identities across twenty 100-item pages", async () => {
    let reads = 0;
    const state = new CatalogState(async (cursor) => {
      const offset = Number(cursor);
      return page(Array.from({ length: 100 }, (_, index) => String(offset + index)),
        offset < 1900 ? String(offset + 100) : null, { total: 2000 });
    }, (item: Item) => { ++reads; return item.id; }, release());
    await state.refresh();
    while (state.snapshot.cursor && !state.snapshot.error) await state.more();
    expect(state.snapshot.items).toHaveLength(2000);
    expect(reads).toBe(2000);
  });
  it("releases finished and abandoned queries without releasing an active append", async () => {
    const drop = release();
    const load = vi.fn().mockResolvedValueOnce(page(["a"], "next")).mockResolvedValueOnce(page(["b", "c"]));
    const state = new CatalogState(load, (item: Item) => item.id, drop);
    await state.refresh(); expect(drop).not.toHaveBeenCalled();
    await state.more(); expect(state.snapshot.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(drop).toHaveBeenCalledExactlyOnceWith("query");
    state.dispose(); expect(drop).toHaveBeenCalledTimes(1);
  });
  it("drops late pages after switching and releases their returned snapshot", async () => {
    const old = deferred<CatalogPage<Item>>(); const drop = release();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(["fresh"], null, { queryId: "fresh" }));
    const state = new CatalogState(load, (item: Item) => item.id, drop);
    const pending = state.refresh(); await state.refresh();
    expect(load.mock.calls[0][1].aborted).toBe(true);
    old.resolve(page(["old"], "next", { queryId: "old" })); await pending;
    expect(state.snapshot.items.map((item) => item.id)).toEqual(["fresh"]);
    expect(drop.mock.calls.map(([id]) => id)).toEqual(["fresh", "old"]);
  });
  it.each([{ catalogRevision: "changed" }, { queryId: "another" }, { total: 4 }])("never combines changed query revisions", async (extra) => {
    const drop = release();
    const load = vi.fn().mockResolvedValueOnce(page(["a"], "next")).mockResolvedValueOnce(page(["b"], null, extra));
    const state = new CatalogState(load, (item: Item) => item.id, drop);
    await state.refresh(); await state.more();
    expect(state.snapshot.items).toEqual([{ id: "a" }]); expect(state.snapshot.cursor).toBeNull();
    expect(state.snapshot.error).toContain("请刷新"); expect(drop).toHaveBeenCalledWith("query");
  });
  it("keeps the loaded items after a failed append and retries the same cursor", async () => {
    const load = vi.fn().mockResolvedValueOnce(page(["a"], "next")).mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "offline"))
      .mockResolvedValueOnce(page(["a", "b", "c"]));
    const state = new CatalogState(load, (item: Item) => item.id, release());
    await state.refresh(); await state.more(); expect(state.snapshot.items).toEqual([{ id: "a" }]);
    await state.retry(); expect(load.mock.calls[2][0]).toBe("next"); expect(state.snapshot.items).toHaveLength(3);
  });
  it("blocks duplicate in-flight appends and non-advancing cursors", async () => {
    const pending = deferred<CatalogPage<Item>>();
    const load = vi.fn().mockResolvedValueOnce(page(["a"], "next")).mockReturnValueOnce(pending.promise);
    const state = new CatalogState(load, (item: Item) => item.id, release());
    await state.refresh(); const more = state.more(); await state.more(); expect(load).toHaveBeenCalledTimes(2);
    pending.resolve(page(["b"], "next")); await more;
    expect(state.snapshot.items).toEqual([{ id: "a" }]); expect(state.snapshot.error).toContain("未能继续加载");
  });
  it("rejects a third page without new IDs and commits only the retry's replacements", async () => {
    const first = page(["a", "b"], "one");
    const rejected = page(["a"], "four");
    const retry = page(["b", "c", "b"]);
    const load = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(page([], "two"))
      .mockResolvedValueOnce(page(["b"], "three")).mockResolvedValueOnce(rejected).mockResolvedValueOnce(retry);
    const state = new CatalogState(load, (item: Item) => item.id, release());
    await state.refresh();
    const initial = state.snapshot.items;
    await state.more(); await state.more(); await state.more();
    expect(state.snapshot.error).toContain("未能继续加载");
    expect(state.snapshot.cursor).toBe("three");
    await state.retry();
    expect(state.snapshot.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(state.snapshot.items[0]).toBe(first.items[0]);
    expect(state.snapshot.items[1]).toBe(retry.items[2]);
    expect(initial[1]).toBe(first.items[1]);
  });
  it("cancels requests and releases a partial query on dispose", async () => {
    const pending = deferred<CatalogPage<Item>>(); const drop = release();
    const load = vi.fn().mockResolvedValueOnce(page(["a"], "next")).mockReturnValueOnce(pending.promise);
    const state = new CatalogState(load, (item: Item) => item.id, drop);
    await state.refresh(); const more = state.more(); state.dispose();
    expect(load.mock.calls[1][1].aborted).toBe(true); expect(drop).toHaveBeenCalledExactlyOnceWith("query");
    pending.resolve(page(["b"])); await more; expect(state.snapshot.items).toEqual([{ id: "a" }]);
  });
});
