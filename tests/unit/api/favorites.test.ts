import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { FavoritesApi } from "../../../src/api/favorites";
import { track } from "../../fixtures/dto";
import { musicTrack } from "../../fixtures/music-catalog";

const entry = { track, musicTrack: musicTrack(track), forcedSourceTrackId: null, recordedAt: "2026-10-22T10:00:00Z" };
const page = { items: [entry], nextCursor: null, revision: "revision-1" };
describe("Favorites API", () => {
  it("loads scoped personal favorites with an opaque cursor", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(page)));
    const api = new FavoritesApi(new ApiClient(fetcher));
    expect(await api.page("next/中文+cursor")).toEqual(page);
    const url = new URL(fetcher.mock.calls[0][0] as string, "https://example.test");
    expect(url.pathname).toBe("/api/v1/me/favorites");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("cursor")).toBe("next/中文+cursor");
  });
  it("uses bodyless CSRF-protected PUT and DELETE requests", async () => {
    const id = "track/中文+one";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ ...entry, musicTrack: {...entry.musicTrack, trackId: id, selectedSource: null}, track: null })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new ApiClient(fetcher); client.csrfToken = "csrf";
    const api = new FavoritesApi(client);
    await api.add(id); await api.remove(id);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe(`/api/v1/me/favorites/${encodeURIComponent(id)}`);
      expect(options?.body).toBeUndefined();
      expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe("csrf");
      expect(new Headers(options?.headers).has("Idempotency-Key")).toBe(false);
    }
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(["PUT", "DELETE"]);
  });
  it.each([{ revision: null }, { items: [{ ...entry, recordedAt: "invalid" }] }, { nextCursor: 12 },
    { items: [{ ...entry, track: { ...track, artists: [2] } }] }])("rejects malformed pages", async (extra) => {
    const api = new FavoritesApi(new ApiClient(vi.fn(async () => new Response(JSON.stringify({ ...page, ...extra })))));
    await expect(api.page()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects a response for another source track", async () => {
    const api = new FavoritesApi(new ApiClient(vi.fn(async () => new Response(JSON.stringify(entry)))));
    await expect(api.add("another")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
