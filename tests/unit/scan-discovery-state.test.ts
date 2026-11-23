import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { ScansApi, type ScanJob, type ScanRequest } from "../../src/api/scans";
import { LocalScanState } from "../../src/library/local-scan-state";

const request: ScanRequest = { mode: "full", schemaRevision: "v5", rootIds: ["music"], options: {} };
const job = (status: ScanJob["status"], observed: number, id = "external"): ScanJob => ({
  jobId: id, providerInstanceId: "local", status, progress: { observed }, complete: status === "succeeded", error: null,
});
function fixture() {
  let stored: string | null = null;
  const storage = { get: () => stored, set: (value: string | null) => { stored = value; } };
  const api = { status: vi.fn<ScansApi["status"]>(async () => null),
    prepare: vi.fn<ScansApi["prepare"]>(async () => request),
    submit: vi.fn<ScansApi["submit"]>(async () => ({ jobId: "own", merged: false })),
    job: vi.fn<ScansApi["job"]>(async () => job("running", 0, "own")) };
  const finished = vi.fn();
  const state = new LocalScanState(api as unknown as ScansApi, "local", storage, finished);
  return { api, state, finished, storage };
}
afterEach(() => vi.useRealTimers());

describe("Read-only scan discovery", () => {
  it("reads once while idle and coalesces updates received during the snapshot", async () => {
    vi.useFakeTimers();
    const { api, state } = fixture();
    let release!: (value: ScanJob | null) => void;
    api.status.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValue(job("succeeded", 42));
    const detach = state.attach();
    state.invalidate();
    state.invalidate();
    expect(api.status).toHaveBeenCalledTimes(1);
    release(null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.status).toHaveBeenCalledTimes(2);
    expect(state.value.job?.progress.observed).toBe(42);
    detach();
  });
  it('adopts a running task even when the previous task is still waiting for its retry', async () => {
    vi.useFakeTimers();
    const { api, state, finished } = fixture();
    api.status.mockResolvedValueOnce(job('retry_wait', 200, 'first')).mockResolvedValue(job('running', 20, 'next'));
    api.job.mockResolvedValueOnce(job('retry_wait', 200, 'first'));
    const detach = state.attach();
    state.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value).toMatchObject({ pending: true, job: { jobId: 'next', status: 'running', progress: { observed: 20 } } });
    expect(finished).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
    detach();
  });
  it("confirms a previous task before adopting a newer active task so its publication is not missed", async () => {
    vi.useFakeTimers();
    const { api, state, finished } = fixture();
    api.status.mockResolvedValueOnce(job('running', 200, 'first')).mockResolvedValue(job('queued', 0, 'next'));
    api.job.mockResolvedValueOnce(job('succeeded', 400, 'first'));
    const detach = state.attach();
    state.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.job).toHaveBeenCalledExactlyOnceWith('first', 'local', expect.any(AbortSignal));
    expect(finished).toHaveBeenCalledExactlyOnceWith(true);
    expect(state.value).toMatchObject({ pending: true, job: { jobId: 'next', status: 'queued' } });
    expect(api.submit).not.toHaveBeenCalled();
    detach();
  });
  it("clears a discovery transport error when an empty history becomes available", async () => {
    vi.useFakeTimers();
    const { api, state } = fixture();
    api.status.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Disconnected"));
    const detach = state.attach();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value.error).toBeTruthy();
    state.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value).toMatchObject({ error: null, job: null, pending: false });
    expect(api.submit).not.toHaveBeenCalled();
    detach();
  });
  it("discovers and updates an external scan, then keeps checking without duplicate completion callbacks", async () => {
    vi.useFakeTimers();
    const { api, state, finished, storage } = fixture();
    api.status.mockResolvedValueOnce(job("running", 0)).mockResolvedValueOnce(job("running", 200))
      .mockResolvedValueOnce(job("running", 400)).mockResolvedValue(job("succeeded", 400));
    const detach = state.attach();
    expect(state.value.checking).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value).toMatchObject({ checking: false, pending: true, job: { progress: { observed: 0 } } });
    await state.start();
    for (const observed of [200, 400]) {
      state.invalidate();
      await vi.advanceTimersByTimeAsync(0);
      expect(state.value.job?.progress.observed).toBe(observed);
    }
    state.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value).toMatchObject({ pending: false, job: { status: "succeeded" } });
    expect(finished).toHaveBeenCalledExactlyOnceWith(true);
    expect(storage.get()).toBeNull();
    expect(api.prepare).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
    expect(api.job).not.toHaveBeenCalled();
    detach();
  });

  it("continues from an empty status and permits a retry to reset its count", async () => {
    vi.useFakeTimers();
    const { api, state } = fixture();
    const oldError = { code: "TEMPORARY_FAILURE", message: "Try again" };
    api.status.mockResolvedValueOnce(null).mockResolvedValueOnce(job("running", 200))
      .mockResolvedValueOnce({ ...job("retry_wait", 200), error: oldError })
      .mockResolvedValueOnce({ ...job("running", 0), error: oldError }).mockResolvedValue(job("running", 300));
    const detach = state.attach();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value.pending).toBe(false);
    for (let i = 0; i < 3; i++) {
      state.invalidate();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(state.value).toMatchObject({ pending: true, error: null, job: { status: "running", progress: { observed: 0 } } });
    state.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value.job?.progress.observed).toBe(300);
    expect(api.submit).not.toHaveBeenCalled();
    detach();
  });

  it("never replaces or resubmits an uncertain request during background discovery", async () => {
    vi.useFakeTimers();
    const { api, state, storage } = fixture();
    const detach = state.attach();
    await vi.advanceTimersByTimeAsync(0);
    api.submit.mockRejectedValueOnce(new ApiError("TIMEOUT", "Unknown outcome"));
    await state.start();
    const original = api.submit.mock.calls[0];
    const saved = storage.get();
    api.status.mockResolvedValue(job("running", 8));
    await state.refreshStatus();
    await vi.advanceTimersByTimeAsync(5000);
    expect(storage.get()).toBe(saved);
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(api.status).toHaveBeenCalledTimes(1);
    expect(state.value.job).toBeNull();
    await state.resume();
    expect(api.submit.mock.calls[1].slice(0, 3)).toEqual(original.slice(0, 3));
    expect(state.value.job?.jobId).toBe("own");
    detach();
  });

  it("discards a late discovery and a waiting manual click when the session detaches", async () => {
    const { api, state, finished } = fixture();
    let resolve!: (value: ScanJob | null) => void;
    api.status.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    state.attach();
    const clicked = state.start();
    const signal = api.status.mock.calls[0][1];
    state.detach();
    expect(signal?.aborted).toBe(true);
    resolve(job("succeeded", 500));
    await clicked;
    expect(state.value.job).toBeNull();
    expect(api.submit).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
  });

  it("waits for an external task before submitting a queued directory change", async () => {
    vi.useFakeTimers();
    const { api, state, storage } = fixture();
    api.status.mockResolvedValue(job("running", 200));
    const detach = state.attach();
    await vi.advanceTimersByTimeAsync(0);
    state.requestAutomatic();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value.automaticQueued).toBe(true);
    expect(api.submit).not.toHaveBeenCalled();
    api.status.mockResolvedValue(job("succeeded", 400));
    state.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(state.value).toMatchObject({ automaticQueued: false, pending: true, job: { jobId: "own" } });
    expect(JSON.parse(storage.get()!).pending.jobId).toBe("own");
    detach();
  });

  it("recovers discovery after a transport failure and sees a newer task after completion", async () => {
    vi.useFakeTimers();
    const { api, state, finished } = fixture();
    api.status.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Disconnected"))
      .mockResolvedValueOnce(job("succeeded", 3)).mockResolvedValue(job("succeeded", 7, "newer"));
    const detach = state.attach();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value.error).toBeTruthy();
    state.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value.error).toBeNull();
    state.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value.job?.jobId).toBe("newer");
    expect(finished).toHaveBeenCalledTimes(2);
    expect(api.submit).not.toHaveBeenCalled();
    detach();
  });
});
