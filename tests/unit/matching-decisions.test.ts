import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/client";
import { MatchingApi, type MatchingRequest } from "../../src/api/matching";
import { MatchingDecisions } from "../../src/library/matching-decisions";
import { deferred } from "../fixtures/dto";

const request: MatchingRequest = { kind: "links", expectedRevision: 2, sourceTrackIds: ["left", "right"], targetRecordingId: null };
const result = { revision: 3, operationId: "operation", recordingId: "recording" };
function storage() {
  const items = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value) });
  return items;
}
afterEach(() => vi.unstubAllGlobals());

describe("Session-owned matching decisions", () => {
  it("keeps submitting and refreshes the library after its view leaves", async () => {
    storage();
    const response = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>(() => response.promise);
    const changed = vi.fn();
    const decisions = new MatchingDecisions(new MatchingApi(new ApiClient(fetcher)), changed);
    decisions.setSession("server", "alice");
    const submitted = decisions.submit(request, "stable-key");
    expect(decisions.pending.value[0].status).toBe("pending");
    expect(decisions.submit(request, "stable-key")).toBe(submitted);
    response.resolve(Response.json(result));
    await submitted;
    expect(changed).toHaveBeenCalledTimes(1);
    expect(decisions.pending.value).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("restores uncertain requests after refresh and replays the exact body and key", async () => {
    storage();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValueOnce(Response.json(result));
    const api = new MatchingApi(new ApiClient(fetcher));
    const first = new MatchingDecisions(api, vi.fn()); first.setSession("server", "alice");
    await expect(first.submit(request, "original-key")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(first.pending.value[0].status).toBe("uncertain");
    const restored = new MatchingDecisions(api, vi.fn()); restored.setSession("server", "alice");
    expect(restored.pending.value[0].request).toEqual(request);
    await restored.submit({ ...request, expectedRevision: 99 }, "original-key");
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("Idempotency-Key")).toBe("original-key");
    expect(restored.pending.value).toEqual([]);
  });
  it("isolates pending decisions by server and user and ignores late responses after logout", async () => {
    storage();
    const response = deferred<Response>();
    const changed = vi.fn();
    const decisions = new MatchingDecisions(new MatchingApi(new ApiClient(vi.fn(() => response.promise))), changed);
    decisions.setSession("server", "alice");
    const submitted = decisions.submit(request, "alice-key");
    decisions.clear(); decisions.setSession("server", "bob");
    expect(decisions.pending.value).toEqual([]);
    response.resolve(Response.json(result)); await submitted;
    expect(changed).not.toHaveBeenCalled();
    decisions.setSession("other-server", "alice"); expect(decisions.pending.value).toEqual([]);
    decisions.setSession("server", "alice"); expect(decisions.pending.value[0]).toMatchObject({ key: "alice-key", status: "uncertain" });
  });
  it.each(["manual-version", null])("restores and confirms a default-source change after refresh (%s)", async (sourceTrackId) => {
    storage();
    const selection: MatchingRequest = { kind: "default-source", expectedRevision: 2, recordingId: "recording", sourceTrackId };
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValueOnce(Response.json(result));
    const api = new MatchingApi(new ApiClient(fetcher));
    const first = new MatchingDecisions(api, vi.fn()); first.setSession("server", "alice");
    await expect(first.submit(selection, "default-key")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    const changed = vi.fn();
    const restored = new MatchingDecisions(api, changed); restored.setSession("server", "alice");
    expect(restored.pending.value).toEqual([{ key: "default-key", request: selection, status: "uncertain" }]);
    await restored.submit({ ...selection, expectedRevision: 99, sourceTrackId: "different" }, "default-key");
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("Idempotency-Key")).toBe("default-key");
    expect(restored.pending.value).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("clears a rejected stale decision without changing its expected revision", async () => {
    storage();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: { code: "REVISION_CONFLICT" } }, { status: 409 }));
    const decisions = new MatchingDecisions(new MatchingApi(new ApiClient(fetcher)), vi.fn());
    decisions.setSession("server", "alice");
    await expect(decisions.submit(request, "key")).rejects.toMatchObject({ status: 409 });
    expect(decisions.pending.value).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).expectedRevision).toBe(2);
  });
});
