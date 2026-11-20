import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { MusicCatalogApi } from "../../../src/api/music-catalog";

const album = { albumId: "album/1", originalName: "Original album", name: "Album", revision: 2, externalId: null,
  isExternal: false, coverPath: null, publisher: null, releaseDate: null, sourceLinks: [] };
const reply = (body: unknown) => new Response(JSON.stringify(body));

describe("Music album list", () => {
  it("includes release information and accepts albums with missing metadata", async () => {
    const items = [
      { ...album, publisher: "Label", releaseDate: "2025-06", trackCount: 2 },
      { albumId: "", name: "", trackCount: 1 },
    ];
    const api = new MusicCatalogApi(new ApiClient(vi.fn().mockResolvedValue(reply({ items, nextAfter: null }))));
    expect((await api.categories("album", "all", "", null)).items).toEqual([
      { id: album.albumId, name: album.name, publisher: "Label", releaseDate: "2025-06", coverPath: null, trackCount: 2 },
      { id: "", name: "", trackCount: 1 },
    ]);
  });
  it.each([{ publisher: {} }, { releaseDate: 2025 }])("rejects malformed release metadata", async (invalid) => {
    const items = [{ ...album, trackCount: 0, ...invalid }];
    const api = new MusicCatalogApi(new ApiClient(vi.fn().mockResolvedValue(reply({ items, nextAfter: null }))));
    await expect(api.categories("album", "all", "", null)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("Music album details", () => {
  it("loads the requested album and retains its revision", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(album));
    expect(await new MusicCatalogApi(new ApiClient(fetch)).album(album.albumId)).toEqual(album);
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/library/albums/album%2F1");
  });
  it.each([{ ...album, albumId: "other" }, { ...album, revision: 0 }, { ...album, publisher: 4 }, { ...album, originalName: null },
    { ...album, sourceLinks: [{ url: "https://example.org/release" }] }, { ...album, sourceLinks: [{ pluginId: "plugin" }] }])
    ("rejects mismatched or malformed album details", async (value) => {
      const api = new MusicCatalogApi(new ApiClient(vi.fn().mockResolvedValue(reply(value))));
      await expect(api.album(album.albumId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });
  it("updates editable fields at the observed revision and preserves the original name", async () => {
    const updated = { ...album, name: "Renamed", publisher: "Publisher", releaseDate: "2020-02-01", revision: 3 };
    const fetch = vi.fn().mockResolvedValue(reply(updated));
    const client = new ApiClient(fetch);
    client.csrfToken = "csrf";
    expect(await new MusicCatalogApi(client).updateAlbum(album,
      { name: "Renamed", publisher: "Publisher", releaseDate: "2020-02-01" }, "edit-album")).toEqual(updated);
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe("/api/v1/library/albums/album%2F1");
    expect(options.headers.get("Idempotency-Key")).toBe("edit-album");
    expect(JSON.parse(options.body)).toEqual({ expectedRevision: 2, name: "Renamed", externalId: null,
      isExternal: false, coverPath: null, publisher: "Publisher", releaseDate: "2020-02-01", sourceLinks: [] });
  });
  it("saves or clears the platform association without querying external metadata", async () => {
    const linked = { ...album, sourceLinks: [{ url: "https://example.org/release", pluginId: "plugin" }], revision: 3 };
    const fetch = vi.fn().mockResolvedValueOnce(reply(linked)).mockResolvedValueOnce(reply({ ...album, revision: 4 }));
    const api = new MusicCatalogApi(new ApiClient(fetch));
    await api.updateAlbum(album, { name: album.name, publisher: "", releaseDate: "",
      sourceLinks: linked.sourceLinks }, "link-album");
    await api.updateAlbum(linked, { name: album.name, publisher: "", releaseDate: "", sourceLinks: [] }, "unlink-album");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([path]) => path === "/api/v1/library/albums/album%2F1")).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ sourceLinks: linked.sourceLinks });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ sourceLinks: [] });
  });
  it.each([{ ...album, originalName: "Overwritten", revision: 3 }, { ...album, revision: 2 }])
    ("rejects an update that overwrites the immutable name or does not advance the revision", async (value) => {
      const api = new MusicCatalogApi(new ApiClient(vi.fn().mockResolvedValue(reply(value))));
      await expect(api.updateAlbum(album, { name: "Renamed", publisher: "", releaseDate: "" }, "edit-album"))
        .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
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
