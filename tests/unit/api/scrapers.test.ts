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
});
