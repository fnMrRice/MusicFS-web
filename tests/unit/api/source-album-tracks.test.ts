import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { LibraryApi } from "../../../src/api/library";
import { sourceAlbumTracks } from "../../../src/api/source-album-tracks";
import { track } from "../../fixtures/dto";

const album = { sourceAlbumId: "album", name: "Album", revision: 1, providerInstanceId: "source /1", sourceTrackIds: ["b", "a"] };
const signal = new AbortController().signal;
const page = (ids: string[], nextCursor: string | null, libraryRevision = "1") =>
  Response.json({ items: ids.map(sourceTrackId => ({ ...track, sourceTrackId })), nextCursor, libraryRevision });

describe("visible source album members", () => {
  it("reads only the album provider, stops at the last member and retains album order", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(page(["other", "a"], "next"))
      .mockResolvedValueOnce(page(["b"], "more"));
    const result = await sourceAlbumTracks(new LibraryApi(new ApiClient(fetcher)), album, signal);
    expect(result.map(item => item.sourceTrackId)).toEqual(["b", "a"]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/source-tracks?limit=100&providerInstanceId=source+%2F1",
      "/api/v1/source-tracks?limit=100&providerInstanceId=source+%2F1&cursor=next",
    ]);
  });

  it("skips empty albums and omits tracks hidden from the music library", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(page(["a"], null));
    const library = new LibraryApi(new ApiClient(fetcher));
    expect(await sourceAlbumTracks(library, { ...album, sourceTrackIds: [] }, signal)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    const result = await sourceAlbumTracks(library, album, signal);
    expect(result.map(item => item.sourceTrackId)).toEqual(["a"]);
  });

  it.each([["next", "1", "PAGINATION_STALLED"], [null, "2", "CURSOR_EXPIRED"]] as const)(
    "rejects inconsistent pages (%s, %s)", async (cursor, revision, code) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(page(["a"], "next"))
        .mockResolvedValueOnce(page([], cursor, revision));
      await expect(sourceAlbumTracks(new LibraryApi(new ApiClient(fetcher)), album, signal)).rejects.toMatchObject({ code });
    },
  );
});
