import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import type { ScansApi, ScanRequest } from "../../src/api/scans";
import { RefreshSubmission } from "../../src/tasks/refresh-submission";

const request = (id: string): ScanRequest => ({ mode: "full", schemaRevision: "revision", rootIds: [id], options: { refreshMetadata: true } });
function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const api = { prepareRefresh: vi.fn(async (_provider: string, _signal?: AbortSignal, root?: string) =>
    (root ? [root] : ["a", "b", "c"]).map(id => ({ name: id.toUpperCase(), request: request(id) }))),
    submit: vi.fn(async (_provider: string, body: ScanRequest, _key: string, _signal?: AbortSignal) => ({ jobId: body.rootIds[0], merged: false })) };
  const accepted = vi.fn(); const state = new RefreshSubmission(api as unknown as ScansApi, accepted, storage);
  state.setSession("server", "user"); return { api, accepted, state, storage };
}
describe("refresh queue submissions", () => {
  it("freezes all roots once and posts three independent requests with distinct keys", async () => {
    const { api, state } = fixture(); await state.start("local");
    expect(api.prepareRefresh).toHaveBeenCalledTimes(1); expect(api.submit).toHaveBeenCalledTimes(3);
    expect(api.submit.mock.calls.map(call => call[1])).toEqual([request("a"), request("b"), request("c")]);
    expect(new Set(api.submit.mock.calls.map(call => call[2])).size).toBe(3);
    expect(state.value.pending).toEqual([]); expect(state.value.notices.local).toEqual({ submitted: 3, merged: 0 });
  });
  it("allows another root while a submission is unknown, without duplicating the same root", async () => {
    const { api, state } = fixture(); let resolve!: (value: { jobId: string; merged: boolean }) => void;
    api.submit.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = state.start("local", "a"); await Promise.resolve(); await Promise.resolve();
    await state.start("local", "a"); await state.start("local", "b");
    expect(api.submit.mock.calls.map(call => call[1].rootIds)).toEqual([["a"], ["b"]]);
    resolve({ jobId: "a", merged: false }); await first;
  });
  it("retains only failed roots and checks original requests after reload without resending completed roots", async () => {
    const { api, state, storage, accepted } = fixture();
    api.submit.mockImplementation(async (_provider, body) => {
      if (body.rootIds[0] === "b") throw new ApiError("NETWORK_ERROR", "Unknown outcome");
      return { jobId: body.rootIds[0], merged: false };
    });
    await state.start("local"); const failed = state.value.pending[0];
    expect(state.value.notices.local.submitted).toBe(2); expect(failed.request.rootIds).toEqual(["b"]);
    state.clear(); const restored = new RefreshSubmission(api as unknown as ScansApi, accepted, storage); restored.setSession("server", "user");
    expect(api.submit).toHaveBeenCalledTimes(3); expect(restored.value.pending[0].sending).toBe(false);
    api.submit.mockResolvedValue({ jobId: "b", merged: true }); await restored.retry(failed.key);
    expect(api.submit).toHaveBeenCalledTimes(4); expect(api.submit.mock.calls[3][1]).toEqual(failed.request);
    expect(api.submit.mock.calls[3][2]).toBe(failed.key); expect(restored.value.pending).toEqual([]);
    expect(restored.value.notices.local.merged).toBe(1);
  });
  it("does not retry accepted or cancelled tasks and separates users' pending requests", async () => {
    const { api, state } = fixture(); await state.start("local", "a"); const key = api.submit.mock.calls[0][2];
    await state.retry(key); expect(api.submit).toHaveBeenCalledTimes(1);
    api.submit.mockRejectedValue(new ApiError("TIMEOUT", "Unknown outcome")); await state.start("local", "b");
    state.setSession("server", "other"); expect(state.value.pending).toEqual([]);
    state.setSession("server", "user"); expect(state.value.pending[0].request.rootIds).toEqual(["b"]);
  });
  it("aborts old requests and ignores acceptance after logout", async () => {
    const { api, accepted, state } = fixture(); let resolve!: (value: { jobId: string; merged: boolean }) => void;
    api.submit.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const work = state.start("local", "a"); await Promise.resolve(); await Promise.resolve();
    const signal = api.submit.mock.calls[0][3]; state.clear(); resolve({ jobId: "a", merged: false }); await work;
    expect(signal?.aborted).toBe(true); expect(accepted).not.toHaveBeenCalled();
  });
  it("serializes preparation for all and individual roots of the same provider", async () => {
    const { api, state } = fixture(); let resolve!: (value: { name: string; request: ScanRequest }[]) => void;
    api.prepareRefresh.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const work = state.start("local"); await state.start("local", "a");
    expect(api.prepareRefresh).toHaveBeenCalledTimes(1);
    resolve([{ name: "A", request: request("a") }]); await work;
    expect(api.submit).toHaveBeenCalledTimes(1);
  });
  it("does not restart a partially submitted batch through the all-folder action", async () => {
    const { api, state } = fixture(); api.submit.mockRejectedValueOnce(new ApiError("TIMEOUT", "Unknown outcome"));
    await state.start("local"); await state.start("local");
    expect(api.submit).toHaveBeenCalledTimes(3); expect(api.prepareRefresh).toHaveBeenCalledTimes(1);
  });
  it("re-prepares definitively rejected roots with new keys, while unknown requests cannot be dismissed", async () => {
    const { api, state } = fixture(); api.submit.mockRejectedValueOnce(new ApiError("CONFLICT", "Stale configuration", 409));
    await state.start("local", "a"); const rejected = state.value.pending[0]; expect(rejected.rejected).toBe(true);
    api.prepareRefresh.mockResolvedValueOnce([{ name: "A", request: { ...request("a"), schemaRevision: "new-revision" } }]);
    await state.retry(rejected.key);
    expect(api.submit.mock.calls[1][1].schemaRevision).toBe("new-revision"); expect(api.submit.mock.calls[1][2]).not.toBe(rejected.key);
    api.submit.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Unknown outcome"));
    await state.start("local", "b"); const unknown = state.value.pending[0]; state.dismiss(unknown.key);
    expect(state.value.pending).toHaveLength(1); expect(unknown.rejected).toBe(false);
  });
  it("allows dismissing removed-root rejections without retaining a permanent batch lock", async () => {
    const { api, state } = fixture(); api.submit.mockRejectedValueOnce(new ApiError("NOT_FOUND", "Root removed", 404));
    await state.start("local", "a"); state.dismiss(state.value.pending[0].key);
    expect(state.value.pending).toEqual([]); await state.start("local", "b"); expect(api.submit).toHaveBeenCalledTimes(2);
  });
  it("keeps unknown outcomes sticky across reload and later configuration conflicts", async () => {
    const { api, state, storage, accepted } = fixture();
    api.submit.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Unknown outcome")); await state.start("local", "a");
    const key = state.value.pending[0].key; expect(state.value.pending[0].uncertain).toBe(true); state.clear();
    const restored = new RefreshSubmission(api as unknown as ScansApi, accepted, storage); restored.setSession("server", "user");
    api.submit.mockRejectedValue(new ApiError("CONFLICT", "New configuration", 409)); await restored.retry(key);
    expect(restored.value.pending[0]).toMatchObject({ key, uncertain: true, rejected: false });
    restored.dismiss(key); expect(restored.value.pending).toHaveLength(1);
    await restored.retry(key);
    expect(api.submit.mock.calls.map(call => call[2])).toEqual([key, key, key]);
    expect(api.prepareRefresh).toHaveBeenCalledTimes(1);
  });
});
