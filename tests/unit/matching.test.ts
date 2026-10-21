import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/client";
import { MatchingApi, mergeRequest, selectedVersions } from "../../src/api/matching";
import { LibraryApi } from "../../src/api/library";
import { LibraryState } from "../../src/library/state";
import type { SourceTrack } from "../../src/api/types";

function track(id: string, recordingId: string | null = null): SourceTrack {
  return { sourceTrackId: id, providerInstanceId: `source-${id}`, displayName: `${id}.flac`, title: null, artists: null,
    durationMs: 1000, codec: "flac", container: "flac", bitrateBps: null, availability: "available", assetId: id, recordingId };
}

describe("Manual recording decisions", () => {
  it("merges all versions from selected rows, preserving the first recording as target", () => {
    const a = { ...track("a", "recording-one"), versions: [track("a", "recording-one"), track("b", "recording-one")] };
    const c = { ...track("c", "recording-two"), versions: [track("c", "recording-two"), track("d", "recording-two")] };
    expect(mergeRequest([a, c], 7)).toEqual({ kind: "links", expectedRevision: 7,
      sourceTrackIds: ["a", "b", "c", "d"], targetRecordingId: "recording-one" });
    expect(selectedVersions([a, track("b")]).map((item) => item.sourceTrackId)).toEqual(["a", "b"]);
  });
  it("allows manual merging without any plugin and bounds the number of sources", () => {
    expect(mergeRequest([track("a"), track("b")], 0)).toMatchObject({ targetRecordingId: null, sourceTrackIds: ["a", "b"] });
    expect(() => mergeRequest([track("a")], 0)).toThrow();
    expect(() => mergeRequest(Array.from({ length: 257 }, (_, index) => track(String(index))), 0)).toThrow();
  });
  it("uses owner-scoped host APIs, expected revisions, CSRF, and a stable retry key", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ revision: 3, operationId: "operation", recordingId: "recording" }));
    const client = new ApiClient(fetcher); client.csrfToken = "csrf";
    const api = new MatchingApi(client);
    const request = mergeRequest([track("a"), track("b")], 2);
    await api.mutate(request, "same-key"); await api.mutate(request, "same-key");
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe("/api/v1/matching/links");
      expect(new Headers(options?.headers).get("Idempotency-Key")).toBe("same-key");
      expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe("csrf");
      expect(JSON.parse(options?.body as string)).toEqual({ expectedRevision: 2, sourceTrackIds: ["a", "b"], targetRecordingId: null });
    }
  });
  it("does not hide revision conflicts or retry with a newer revision", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: { code: "REVISION_CONFLICT" } }, { status: 409 }));
    await expect(new MatchingApi(new ApiClient(fetcher)).mutate({ kind: "unlinks", sourceTrackId: "a", expectedRevision: 1 }, "key"))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("pages global candidates and rejects missing comparison tracks", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ revision: 1, items: [{ candidateId: "pair", score: 90,
      left: { sourceTrackId: "a" }, right: { sourceTrackId: "b" }, leftTrack: track("a"), rightTrack: track("b"), reasons: [] }], nextAfter: "next" }));
    const api = new MatchingApi(new ApiClient(fetcher));
    expect((await api.candidates("cursor /1")).items).toHaveLength(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/matching/candidates?limit=20&after=cursor+%2F1");
    fetcher.mockResolvedValueOnce(Response.json({ revision: 1, items: [{ candidateId: "pair" }], nextAfter: null }));
    await expect(api.candidates(null)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("Grouped library snapshots", () => {
  it("requests grouping only for the main library and supports an older server response", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [track("a")], libraryRevision: "1", nextCursor: null }));
    const api = new LibraryApi(new ApiClient(fetcher));
    const legacy = await api.page("all", null, undefined, true);
    expect(legacy.matchingRevision).toBeUndefined();
    expect(fetcher.mock.calls[0][0]).toContain("groupBy=recording");
    await api.page("all", null);
    expect(fetcher.mock.calls[1][0]).not.toContain("groupBy");
  });
  it("rejects a grouped result that omits versions or the representative", async () => {
    for (const versions of [undefined, [], [track("b")], [track("a"), track("a")]]) {
      const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [{ ...track("a"), versions }], matchingRevision: 1, libraryRevision: "1", nextCursor: null }));
      await expect(new LibraryApi(new ApiClient(fetcher)).page("all", null, undefined, true)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });
  it("does not append pages from a different matching revision even if music scanning is unchanged", async () => {
    const load = vi.fn().mockResolvedValueOnce({ items: [track("a")], nextCursor: "next", libraryRevision: "1", matchingRevision: 3 })
      .mockResolvedValueOnce({ items: [track("b")], nextCursor: null, libraryRevision: "1", matchingRevision: 4 });
    const state = new LibraryState(load);
    await state.select("all"); await state.more();
    expect(state.snapshot.items.map((item) => item.sourceTrackId)).toEqual(["a"]);
    expect(state.snapshot.matchingRevision).toBe(3);
    expect(state.snapshot.error).toContain("请刷新");
  });
});
