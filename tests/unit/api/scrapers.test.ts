import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { ScrapersApi, type TrackMediaSelection } from "../../../src/api/scrapers";
import { externalLink } from "../../../src/features/scrapers/fields";

const reply = (body: unknown) => new Response(JSON.stringify(body));
const target = { sourceTrackId: "track/1", assetId: "asset", assetVersion: "v1" };
const selection: TrackMediaSelection = { target, revision: 2 };

describe("Scraper content declarations and selection", () => {
  it("rejects a source that does not declare scraper type", async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ items: [{ name: "Source", pluginId: "a", type: "provider", fields: ["lyrics"], available: true }] }));
    await expect(new ScrapersApi(new ApiClient(fetch)).list()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("requires a selection token and valid published track details", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ items: [{ id: "x", title: "Album", tracks: [] }] }))
      .mockResolvedValueOnce(reply({ items: [{ pluginId: "plugin", field: "albumTracks", item: { id: "x", title: "Album", tracks: [{ title: 3 }] } }] }));
    const api = new ScrapersApi(new ApiClient(fetch));
    await expect(api.search("plugin", "albumTracks", { title: "Album" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.saved("work")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("passes only the observed track revision and asset identity with the signed selection", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ ...selection, revision: 3 }));
    const client = new ApiClient(fetch);
    client.csrfToken = "csrf";
    await new ScrapersApi(client).applyMedia(selection, "lyrics", "plugin", "token", "stable-key");
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe("/api/v1/source-tracks/track%2F1/scraped-fields/lyrics");
    expect(options.headers.get("Idempotency-Key")).toBe("stable-key");
    expect(JSON.parse(options.body)).toEqual({ expectedRevision: 2, assetId: "asset", assetVersion: "v1", pluginId: "plugin", candidateToken: "token" });
  });
  it("restricts outgoing result links to credential-free HTTPS URLs", () => {
    expect(externalLink("javascript:alert(1)")).toBeUndefined();
    expect(externalLink("https://a:b@example.org/page")).toBeUndefined();
    expect(externalLink("https://example.org/release/1")).toBe("https://example.org/release/1");
  });
  it("reads album metadata and saves selections against its own revision and identity", async () => {
    const field = { field: "albumTracks", pluginId: "plugin", item: { id: "release", title: "Album", tracks: [{ title: "First" }] } };
    const fetch = vi.fn().mockResolvedValueOnce(reply({ items: [field] })).mockResolvedValueOnce(reply({ revision: 4 }));
    const client = new ApiClient(fetch);
    client.csrfToken = "csrf";
    const api = new ScrapersApi(client);
    expect(await api.savedAlbum("album/1")).toEqual([field]);
    await api.applyAlbum("album/1", "albumTracks", 3, "plugin", "token", "album-selection");
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/library/albums/album%2F1/scraped-fields");
    const [path, options] = fetch.mock.calls[1];
    expect(path).toBe("/api/v1/library/albums/album%2F1/scraped-fields/albumTracks");
    expect(options.headers.get("Idempotency-Key")).toBe("album-selection");
    expect(JSON.parse(options.body)).toEqual({ expectedRevision: 3, pluginId: "plugin", candidateToken: "token" });
  });
  it("rejects unsupported album content and a non-advancing saved revision", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ items: [{ field: "lyrics", pluginId: "plugin", item: { id: "release", title: "Album" } }] }))
      .mockResolvedValueOnce(reply({ revision: 3 }));
    const api = new ScrapersApi(new ApiClient(fetch));
    await expect(api.savedAlbum("album")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.applyAlbum("album", "artwork", 3, "plugin", "token", "key")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("submits a complete release as one revision-protected idempotent selection", async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ revision: 4 }));
    const client = new ApiClient(fetch);
    client.csrfToken = "csrf";
    const candidates = { albumDetails: "details-token", albumTracks: "tracks-token" };
    await new ScrapersApi(client).applyAlbumBundle("album/1", 3, "plugin", candidates, "complete-album");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe("/api/v1/library/albums/album%2F1/scraped-fields");
    expect(options.headers.get("Idempotency-Key")).toBe("complete-album");
    expect(JSON.parse(options.body)).toEqual({ expectedRevision: 3, pluginId: "plugin", candidates });
  });
  it("sends only explicitly selected merge fields with their original candidate pair and revision", async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ revision: 4 }));
    const client = new ApiClient(fetch);
    client.csrfToken = "csrf";
    const candidates = { albumDetails: "details-token", albumTracks: "tracks-token" };
    await new ScrapersApi(client).mergeAlbumMetadata("album/1", 3, "plugin", candidates, ["tracks"], "merge-album");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe("/api/v1/library/albums/album%2F1/metadata-merge");
    expect(options.headers.get("Idempotency-Key")).toBe("merge-album");
    expect(JSON.parse(options.body)).toEqual({ expectedRevision: 3, pluginId: "plugin", candidates, fields: ["tracks"] });
  });
  it("rejects a merge response that does not advance the observed revision", async () => {
    const api = new ScrapersApi(new ApiClient(vi.fn().mockResolvedValue(reply({ revision: 3 }))));
    await expect(api.mergeAlbumMetadata("album", 3, "plugin", { albumDetails: "a", albumTracks: "b" }, ["name"], "key"))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
