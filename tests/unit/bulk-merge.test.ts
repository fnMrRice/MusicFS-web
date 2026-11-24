import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/client";
import { bulkMergeRequest, MatchingApi } from "../../src/api/matching";
import { MatchingDecisions } from "../../src/library/matching-decisions";
import { deferred } from "../fixtures/dto";
import matchingMessages from "../../src/i18n/matching";

const result = { revision: 3, operationId: "bulk", recordingId: null, mergedGroups: 2, mergedSources: 5, skippedGroups: 1 };
function storage() {
  const items = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value) });
  return items;
}
afterEach(() => vi.unstubAllGlobals());

describe("Bulk duplicate merging", () => {
  it("accepts score boundaries, rejects invalid scores, and omits irrelevant title-mode parameters", () => {
    for (const score of [0, 80, 100]) expect(bulkMergeRequest("score", 2, score)).toEqual({
      kind: "bulk-merge", expectedRevision: 2, mode: "score", minimumScore: score,
    });
    for (const score of [-1, 101, 80.5, NaN, Infinity]) expect(() => bulkMergeRequest("score", 2, score)).toThrow();
    expect(bulkMergeRequest("score", 2)).toMatchObject({ minimumScore: 80 });
    expect(bulkMergeRequest("title_artist", 2, NaN)).toEqual({ kind: "bulk-merge", expectedRevision: 2, mode: "title_artist" });
  });
  it("submits the full-library request without a source filter and verifies returned counts", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(result));
    const api = new MatchingApi(new ApiClient(fetcher));
    expect(await api.mutate(bulkMergeRequest("score", 2), "bulk-key")).toEqual(result);
    const [path, options] = fetcher.mock.calls[0];
    expect(path).toBe("/api/v1/matching/bulk-merge");
    expect(new Headers(options?.headers).get("Idempotency-Key")).toBe("bulk-key");
    expect(JSON.parse(options?.body as string)).toEqual({ expectedRevision: 2, mode: "score", minimumScore: 80 });
    for (const invalid of [{ ...result, mergedGroups: -1 }, { ...result, mergedSources: undefined }, { ...result, skippedGroups: 0.5 }]) {
      fetcher.mockResolvedValueOnce(Response.json(invalid));
      await expect(api.mutate(bulkMergeRequest("score", 2), "bulk-key")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });
  it.each([null, -1, 1.5, "2"])("rejects an invalid revision %j", async revision => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ revision }));
    await expect(new MatchingApi(new ApiClient(fetcher)).revision()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("persists uncertain bulk decisions, locks other mutations, and recovers exact parameters", async () => {
    storage();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValueOnce(Response.json(result));
    const api = new MatchingApi(new ApiClient(fetcher));
    const original = bulkMergeRequest("score", 2, 91);
    const first = new MatchingDecisions(api, vi.fn()); first.setSession("server", "alice");
    await expect(first.submit(original, "original-key")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    const restored = new MatchingDecisions(api, vi.fn()); restored.setSession("server", "alice");
    expect(restored.pending.value[0]).toMatchObject({ request: original, status: "uncertain" });
    await expect(restored.submit(bulkMergeRequest("title_artist", 99), "different-key")).rejects.toMatchObject({ code: "MATCHING_PENDING" });
    await restored.submit(bulkMergeRequest("title_artist", 99), "original-key");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("Idempotency-Key")).toBe("original-key");
    expect(restored.lastBulkMerge.value).toEqual(result);
    expect(restored.pending.value).toEqual([]);
    restored.clear(); expect(restored.lastBulkMerge.value).toBeNull();
  });
  it("keeps malformed success responses recoverable and ignores invalid persisted rules", async () => {
    const items = storage();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ revision: 3 }));
    const decisions = new MatchingDecisions(new MatchingApi(new ApiClient(fetcher)), vi.fn());
    decisions.setSession("server", "alice");
    await expect(decisions.submit(bulkMergeRequest("title_artist", 2), "key")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(decisions.pending.value[0].status).toBe("uncertain");
    const storageKey = [...items.keys()][0];
    const saved = JSON.parse(items.get(storageKey)!);
    items.set(storageKey, JSON.stringify([...saved, { key: "bad", request: { kind: "bulk-merge", mode: "score", minimumScore: 101, expectedRevision: 2 } }]));
    decisions.setSession("server", "alice");
    expect(decisions.pending.value.map((item) => item.key)).toEqual(["key"]);
  });
  it("retains completion statistics and refreshes caches after the view leaves", async () => {
    storage(); const response = deferred<Response>(); const changed = vi.fn();
    const decisions = new MatchingDecisions(new MatchingApi(new ApiClient(vi.fn(() => response.promise))), changed);
    decisions.setSession("server", "alice");
    const submitted = decisions.submit(bulkMergeRequest("title_artist", 2), "key");
    response.resolve(Response.json(result)); await submitted;
    expect(changed).toHaveBeenCalledTimes(1); expect(decisions.lastBulkMerge.value).toEqual(result);
  });
  it("unlocks expired receipts without automatically resubmitting a bulk merge", async () => {
    storage();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValueOnce(Response.json({ error: { code: "IDEMPOTENCY_EXPIRED" } }, { status: 410 }));
    const changed = vi.fn();
    const decisions = new MatchingDecisions(new MatchingApi(new ApiClient(fetcher)), changed);
    decisions.setSession("server", "alice");
    const request = bulkMergeRequest("score", 2);
    await expect(decisions.submit(request, "expired-key")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    decisions.setSession("server", "alice");
    await expect(decisions.submit(request, "expired-key")).rejects.toMatchObject({ status: 410 });
    expect(decisions.pending.value).toEqual([]); expect(decisions.lastBulkMerge.value).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenCalledTimes(2);
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("Idempotency-Key")).toBe("expired-key");
  });
  it("has complete matching translations with matching interpolation parameters", () => {
    const parameters = (value: string) => [...value.matchAll(/\{\w+\}/g)].map((item) => item[0]).sort();
    for (const [key, translations] of Object.entries(matchingMessages)) for (const translation of translations) {
      expect(translation.trim(), key).not.toBe(""); expect(parameters(translation), key).toEqual(parameters(key));
    }
  });
});
