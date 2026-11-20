import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { MusicCatalogApi } from "../../../src/api/music-catalog";

const album = { albumId: "album/1", name: "Album", revision: 2, externalId: null,
  isExternal: false, coverPath: null, publisher: null, releaseDate: null };
const reply = (body: unknown) => new Response(JSON.stringify(body));

describe("Music album details", () => {
  it("loads the requested album and retains its revision", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(album));
    expect(await new MusicCatalogApi(new ApiClient(fetch)).album(album.albumId)).toEqual(album);
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/library/albums/album%2F1");
  });
  it.each([{ ...album, albumId: "other" }, { ...album, revision: 0 }, { ...album, publisher: 4 }])
    ("rejects mismatched or malformed album details", async (value) => {
      const api = new MusicCatalogApi(new ApiClient(vi.fn().mockResolvedValue(reply(value))));
      await expect(api.album(album.albumId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });
});

describe("Music catalog source filter", () => {
  it.each([true, false, undefined])("preserves the explicit source filter without filtering category requests (%s)", async (sourceOnly) => {
    const fetch = vi.fn().mockImplementation(async () => reply({ items: [], libraryRevision: "1", matchingRevision: 0, nextAfter: null }));
    const api = new MusicCatalogApi(new ApiClient(fetch));
    await api.tracks({ providerInstanceId: "all", sourceOnly }, null);
    const query = new URL(fetch.mock.calls[0][0], "https://example.org").searchParams;
    expect(query.get("sourceOnly")).toBe(sourceOnly === undefined ? null : String(sourceOnly));
    expect(query.has("providerInstanceId")).toBe(false);
    await api.tracks({ artistId: "artist-1", albumId: "album-1" }, null);
    const category = new URL(fetch.mock.calls[1][0], "https://example.org").searchParams;
    expect(category.get("artistId")).toBe("artist-1");
    expect(category.get("albumId")).toBe("album-1");
    expect(category.has("sourceOnly")).toBe(false);
  });
});
