import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { remotePlaylistEntries } from "../../../src/api/playlist-links";

const track = (id: number) => ({ externalId: String(id), title: "Track", album: "", artists: [], durationMs: null, sourceUrl: "" });
describe("online playlist track references", () => {
  it("registers batches of at most fifty tracks in order under the selected account", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      expect(body.accountId).toBe("account");
      return Response.json({ items: body.externalIds.map((id: string) => ({ remoteSourceId: `remote-${id}` })) });
    });
    const tracks = Array.from({ length: 52 }, (_, index) => track(index % 51));
    const result = await remotePlaylistEntries(new ApiClient(fetcher), { instanceId: "instance", accountId: "account", tracks }, new AbortController().signal);
    expect(fetcher.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).externalIds.length)).toEqual([50, 2]);
    expect(result.map((entry) => entry.source.remoteSourceId)).toEqual(tracks.map((item) => `remote-${item.externalId}`));
  });
  it("rejects an incomplete registration before a local playlist can be written", async () => {
    const client = new ApiClient(async () => Response.json({ items: [] }));
    await expect(remotePlaylistEntries(client, { instanceId: "instance", accountId: "account", tracks: [track(1)] },
      new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
