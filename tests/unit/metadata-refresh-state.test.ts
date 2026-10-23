import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { ScansApi, type ScanJob, type ScanRequest } from "../../src/api/scans";
import { LocalScanState } from "../../src/library/local-scan-state";

const request: ScanRequest = { mode: "full", schemaRevision: "v5", rootIds: ["one"], options: { refreshMetadata: true } };
const job: ScanJob = { jobId: "job-1", providerInstanceId: "local", status: "succeeded", complete: true, progress: { observed: 2 }, error: null };
const completed = { total: 2, completed: 2, applied: 2, skipped: 2, failed: 0, pending: false };
function fixture(saved: string | null = null) {
  let stored = saved;
  const storage = { get: () => stored, set: (value: string | null) => { stored = value; } };
  const api = { prepare: vi.fn<ScansApi["prepare"]>(async () => request),
    status: vi.fn<ScansApi["status"]>(async () => null),
    submit: vi.fn<ScansApi["submit"]>(async () => ({ jobId: "job-1", merged: false })),
    job: vi.fn<ScansApi["job"]>(async () => job),
    metadataResults: vi.fn<ScansApi["metadataResults"]>(async () => ({ ...completed, completed: 1, pending: true })) };
  const finished = vi.fn();
  const state = new LocalScanState(api as unknown as ScansApi, "local", storage, finished);
  return { state, api, storage, finished };
}
afterEach(() => vi.useRealTimers());

describe("Folder metadata refresh", () => {
  it("keeps a finished metadata summary during read-only discovery and clears it for a different job", async () => {
    const { state, api, finished } = fixture();
    api.metadataResults.mockResolvedValueOnce({ ...completed, failed: 1 });
    await state.refresh("one");
    api.status.mockResolvedValueOnce(job);
    await state.refreshStatus();
    expect(state.value).toMatchObject({ refreshing: true, pending: false, metadata: { failed: 1 } });
    expect(state.value.error).toContain("刷新失败");
    expect(finished).toHaveBeenCalledExactlyOnceWith(true);
    api.status.mockResolvedValueOnce({ ...job, jobId: "another", status: "running", complete: false });
    await state.refreshStatus();
    expect(state.value).toMatchObject({ refreshing: false, pending: true, metadata: null, job: { jobId: "another" } });
    expect(api.submit).toHaveBeenCalledTimes(1);
  });
  it("keeps the folder busy after scanning until artwork and lyrics finish", async () => {
    vi.useFakeTimers();
    const { state, api, finished } = fixture();
    const detach = state.attach();
    await Promise.all([state.refresh("one"), state.refresh("one")]);
    expect(api.prepare).toHaveBeenCalledExactlyOnceWith("local", expect.any(AbortSignal), "one");
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(state.value).toMatchObject({ refreshing: true, pending: true, metadata: { completed: 1 } });
    expect(finished).not.toHaveBeenCalled();
    await state.start();
    expect(api.submit).toHaveBeenCalledTimes(1);
    api.metadataResults.mockResolvedValueOnce(completed);
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.value).toMatchObject({ pending: false, error: null, metadata: completed });
    expect(finished).toHaveBeenCalledExactlyOnceWith(true);
    detach();
  });
  it("restores a refresh after reload without submitting another job", async () => {
    const first = fixture();
    await first.state.refresh("one");
    const restored = fixture(first.storage.get());
    expect(restored.state.value.refreshing).toBe(true);
    restored.api.metadataResults.mockResolvedValueOnce(completed);
    await restored.state.resume();
    expect(restored.api.prepare).not.toHaveBeenCalled();
    expect(restored.api.submit).not.toHaveBeenCalled();
    expect(restored.storage.get()).toBeNull();
    expect(restored.finished).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("retains the refresh request and key after an uncertain submission", async () => {
    const first = fixture();
    first.api.submit.mockRejectedValueOnce(new ApiError("TIMEOUT", "Timed out"));
    await first.state.refresh("one");
    const restored = fixture(first.storage.get());
    await restored.state.resume();
    expect(restored.api.submit.mock.calls[0].slice(0, 3)).toEqual(first.api.submit.mock.calls[0].slice(0, 3));
  });
  it("reports partial failure while refreshing the library with successful changes", async () => {
    const { state, api, finished } = fixture();
    api.metadataResults.mockResolvedValueOnce({ ...completed, failed: 1 });
    await state.refresh("one");
    expect(state.value).toMatchObject({ pending: false, metadata: { failed: 1 } });
    expect(state.value.error).toContain("刷新失败");
    expect(finished).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("resumes metadata confirmation after a network failure", async () => {
    const { state, api, finished } = fixture();
    api.metadataResults.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Disconnected"));
    await state.refresh("one");
    expect(state.value.pending).toBe(true);
    expect(finished).not.toHaveBeenCalled();
    api.metadataResults.mockResolvedValueOnce(completed);
    await state.resume();
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(state.value.error).toBeNull();
  });
});
