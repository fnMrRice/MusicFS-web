import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { ContentApi } from "../../../src/api/content";
import { resolveOnlineAudio } from "../../../src/api/online-audio";

const json = (value: unknown) => new Response(JSON.stringify(value));
const instance = "fb663e04-b0eb-4b69-bbf5-920b30559459";

describe("Bilibili anonymous metadata and playback", () => {
  it("imports an anonymous collection without requesting account credentials", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ items: [{ instanceId: instance, platform: "bilibili", authentication: "anonymous", capabilities: [] }] }))
      .mockResolvedValueOnce(json({ playlist: { playlistId: "imported" }, merged: false }));
    const client = new ApiClient(fetcher);
    client.csrfToken = "session-csrf";
    await new ContentApi(client).importRemote(instance, "favorite:123");
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(["/api/v1/online-instances", "/api/v1/remote-playlists"]);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ instanceId: instance, externalId: "favorite:123", accountId: "" });
    expect(fetcher.mock.calls[1][1].headers.get("X-CSRF-Token")).toBe("session-csrf");
  });

  it("keeps link parsing on the scoped server and does not import a preview", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ playlists: [{ externalId: "audio-menu:123", title: "Playlist" }] }));
    const result = await new ContentApi(new ApiClient(fetcher)).playlistReference(instance, "https://www.bilibili.com/audio/am123");
    const url = new URL(fetcher.mock.calls[0][0], "https://musicfs.test");
    expect(url.pathname).toBe(`/api/v1/online-instances/${instance}/search`);
    expect(url.searchParams.get("kind")).toBe("playlists");
    expect(result.externalId).toBe("audio-menu:123");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("resolves metadata through the server with CSRF and no browser CDN request", async () => {
    const track = { sourceTrackId: "source", providerInstanceId: instance, assetId: "asset", availability: "available" };
    const fetcher = vi.fn().mockResolvedValue(json(track));
    const client = new ApiClient(fetcher);
    client.csrfToken = "csrf";
    expect(await resolveOnlineAudio(client, instance, "video:BV13x41117TL:123", new AbortController().signal)).toEqual(track);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/v1/online-instances/${instance}/tracks/video%3ABV13x41117TL%3A123/resolve`);
    expect(fetcher.mock.calls[0][1].headers.get("X-CSRF-Token")).toBe("csrf");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a resource that cannot be passed to the player", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ url: "https://cdn.invalid/signed" }));
    await expect(resolveOnlineAudio(new ApiClient(fetcher), instance, "audio:123", new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
