import { describe, expect, it, vi } from "vitest";
import { CategoriesApi, type Category } from "../../../src/api/categories";
import { ApiClient } from "../../../src/api/client";

const category: Category = { categoryId: "opaque/&unknown", kind: "artist", name: "Unknown artist", unknown: true,
  providerInstanceId: "provider", rootId: "", parentId: null, trackCount: 2, breadcrumbs: [] };
const page = (extra = {}) => ({ queryId: "snapshot", query: { type: "categories", categoryKind: "artist", providerInstanceId: "provider", q: "中文 & artist" },
  catalogRevision: "revision", expiresAt: "2026-10-22T12:00:00Z", total: 1, items: [category], nextCursor: null, ...extra });

describe("Category API", () => {
  it("keeps category scope, search and opaque cursor on every append", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(page())));
    const api = new CategoriesApi(new ApiClient(fetcher));
    const result = await api.categories({ categoryKind: "artist", providerInstanceId: "provider", q: "中文 & artist" }, "opaque/next+page");
    const url = new URL(fetcher.mock.calls[0][0] as string, "https://example.test");
    expect(url.pathname).toBe("/api/v1/library/categories");
    expect(url.searchParams.get("cursor")).toBe("opaque/next+page");
    expect(url.searchParams.get("q")).toBe("中文 & artist");
    expect(url.searchParams.get("providerInstanceId")).toBe("provider");
    expect(url.searchParams.has("type")).toBe(false);
    expect(result.items[0].unknown).toBe(true);
  });
  it("uses the track endpoint with category identity and no fabricated all provider", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(page({ query: { type: "tracks", categoryKind: "folder", categoryId: "folder/中文" }, items: [], total: 0 }))));
    await new CategoriesApi(new ApiClient(fetcher)).tracks({ categoryKind: "folder", categoryId: "folder/中文", providerInstanceId: "all" }, null);
    const url = new URL(fetcher.mock.calls[0][0] as string, "https://example.test");
    expect(url.pathname).toBe("/api/v1/library/search");
    expect(url.searchParams.get("type")).toBe("tracks");
    expect(url.searchParams.get("categoryId")).toBe("folder/中文");
    expect(url.searchParams.has("providerInstanceId")).toBe(false);
  });
  it.each([
    { items: [{ ...category, trackCount: -1 }] },
    { items: [{ ...category, kind: "album" }] },
    { query: { type: "categories", categoryKind: "artist", providerInstanceId: "another" } },
    { total: "1" }, { nextCursor: 2 },
  ])("rejects invalid or mismatched pages", async (extra) => {
    const api = new CategoriesApi(new ApiClient(vi.fn(async () => new Response(JSON.stringify(page(extra))))));
    await expect(api.categories({ categoryKind: "artist", providerInstanceId: "provider", q: "中文 & artist" }, null)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("releases snapshots with CSRF and keeps media URLs on the API route", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new ApiClient(fetcher); client.csrfToken = "csrf";
    await new CategoriesApi(client).release("snapshot/one");
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/library/queries/snapshot%2Fone");
    expect(options.method).toBe("DELETE"); expect(options.keepalive).toBe(true);
    expect(new Headers(options.headers).get("X-CSRF-Token")).toBe("csrf");
    expect(client.url("/media/object")).toBe("/api/v1/media/object");
  });
});
