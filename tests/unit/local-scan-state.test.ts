import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { ScansApi, type ScanJob, type ScanRequest } from "../../src/api/scans";
import { LocalScanState } from "../../src/library/local-scan-state";

const request: ScanRequest = { mode: "full", schemaRevision: "v5", rootIds: ["one", "two"], options: {} };
const job = (status: ScanJob["status"], complete = false): ScanJob => ({ jobId: "job-1", providerInstanceId: "local",
  status, complete, progress: { observed: 12 }, error: null });
function fixture(saved: string | null = null) {
  let stored = saved;
  const storage = { get: () => stored, set: vi.fn((value: string | null) => { stored = value; }) };
  const api = { prepare: vi.fn<ScansApi["prepare"]>(async () => request), submit: vi.fn<ScansApi["submit"]>(async () => ({ jobId: "job-1", merged: false })),
    job: vi.fn<ScansApi["job"]>(async () => job("queued")) };
  const finished = vi.fn();
  const state = new LocalScanState(api as unknown as ScansApi, "local", storage, finished);
  return { api, storage, state, finished };
}
afterEach(() => vi.useRealTimers());

describe("Local music scan state", () => {
  it("deduplicates clicks, preserves the accepted job, and does not treat queued as success", async () => {
    const { state, api, storage, finished } = fixture();
    await Promise.all([state.start(), state.start()]);
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(state.value).toMatchObject({ pending: true, busy: false, job: { status: "queued" }, error: null });
    expect(JSON.parse(storage.get()!).pending.jobId).toBe("job-1");
    expect(finished).not.toHaveBeenCalled();
    await state.start();
    expect(api.submit).toHaveBeenCalledTimes(1);
  });
  it("keeps polling retry_wait and running even when they contain a previous attempt's error", async () => {
    vi.useFakeTimers();
    const { state, api, finished } = fixture();
    const detach = state.attach();
    api.job.mockResolvedValueOnce(job("queued"))
      .mockResolvedValueOnce({ ...job("retry_wait"), error: { code: "NETWORK_ERROR", message: "Temporary" } })
      .mockResolvedValueOnce({ ...job("running"), error: { code: "NETWORK_ERROR", message: "Temporary" } })
      .mockResolvedValueOnce(job("succeeded", true));
    await state.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.value).toMatchObject({ pending: true, job: { status: "retry_wait" }, error: null });
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.value).toMatchObject({ pending: true, job: { status: "running" }, error: null });
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.value).toMatchObject({ pending: false, job: { status: "succeeded" }, error: null });
    expect(finished).toHaveBeenCalledExactlyOnceWith(true);
    detach();
  });
  it.each(["failed", "paused", "cancelled", "succeeded"] as const)("reports %s with complete:false as a terminal failure", async (status) => {
    const { state, api, finished, storage } = fixture();
    api.job.mockResolvedValue(job(status));
    await state.start();
    expect(state.value.pending).toBe(false);
    expect(state.value.error).toBeTruthy();
    expect(finished).toHaveBeenCalledExactlyOnceWith(false);
    expect(storage.get()).toBeNull();
    await state.start();
    expect(api.submit.mock.calls[1][2]).not.toBe(api.submit.mock.calls[0][2]);
  });
  it("retains the exact request and key after uncertain submission and refresh", async () => {
    const first = fixture();
    first.api.submit.mockRejectedValueOnce(new ApiError("TIMEOUT", "Timed out"));
    await first.state.start();
    const original = first.api.submit.mock.calls[0];
    expect(first.state.value).toMatchObject({ pending: true, busy: false });
    const restored = fixture(first.storage.get());
    await restored.state.resume();
    expect(restored.api.prepare).not.toHaveBeenCalled();
    expect(restored.api.submit).toHaveBeenCalledWith("local", original[1], original[2], expect.any(AbortSignal));
  });
  it("polls the saved job after navigation without creating another submission", async () => {
    const first = fixture();
    await first.state.start();
    const restored = fixture(first.storage.get());
    restored.api.job.mockResolvedValue(job("succeeded", true));
    await restored.state.resume();
    expect(restored.api.submit).not.toHaveBeenCalled();
    expect(restored.api.prepare).not.toHaveBeenCalled();
    expect(restored.api.job).toHaveBeenCalledExactlyOnceWith("job-1", "local", expect.any(AbortSignal));
    expect(restored.finished).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("pauses polling on a transport failure and resumes only the existing job", async () => {
    vi.useFakeTimers();
    const { state, api } = fixture();
    const detach = state.attach();
    api.job.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Disconnected"));
    await state.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.job).toHaveBeenCalledTimes(1);
    expect(state.value.pending).toBe(true);
    await state.resume();
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(api.job).toHaveBeenCalledTimes(2);
    detach();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.job).toHaveBeenCalledTimes(2);
  });
  it("abandons definite rejection and allows a fresh request with an updated schema", async () => {
    const { state, api, storage } = fixture();
    api.submit.mockRejectedValueOnce(new ApiError("REVISION_CONFLICT", "Schema changed", 409));
    await state.start();
    expect(storage.get()).toBeNull();
    api.prepare.mockResolvedValueOnce({ ...request, schemaRevision: "v6" });
    await state.start();
    expect(api.submit.mock.calls[1][1].schemaRevision).toBe("v6");
    expect(api.submit.mock.calls[1][2]).not.toBe(api.submit.mock.calls[0][2]);
  });
  it("reports a disappeared job and never claims success", async () => {
    const { state, api, finished } = fixture();
    api.job.mockRejectedValueOnce(new ApiError("NOT_FOUND", "Missing", 404));
    await state.start();
    expect(state.value.pending).toBe(false);
    expect(state.value.error).toContain("扫描记录已不可用");
    expect(finished).not.toHaveBeenCalled();
  });
  it("aborts on detach but preserves a submitted request for safe confirmation", async () => {
    const { state, api, storage } = fixture();
    let resolve!: (value: { jobId: string; merged: boolean }) => void;
    api.submit.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = state.start();
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    const signal = api.submit.mock.calls[0][3];
    state.detach();
    expect(signal?.aborted).toBe(true);
    resolve({ jobId: "job-1", merged: false });
    await pending;
    expect(state.value.busy).toBe(false);
    expect(api.job).not.toHaveBeenCalled();
    expect(JSON.parse(storage.get()!).pending.jobId).toBeNull();
    await state.resume();
    expect(api.submit.mock.calls[1][2]).toBe(api.submit.mock.calls[0][2]);
  });
});
