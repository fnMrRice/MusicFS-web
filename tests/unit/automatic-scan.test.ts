import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { ScansApi, type ScanJob, type ScanRequest } from "../../src/api/scans";
import { LocalScanState } from "../../src/library/local-scan-state";

const request: ScanRequest = { mode: "full", schemaRevision: "v5", rootIds: ["one"], options: {} };
const job = (status: ScanJob["status"]): ScanJob => ({ jobId: "job-1", providerInstanceId: "local", status,
  complete: status === "succeeded", progress: { observed: 2 }, error: null });
function fixture(saved: string | null = null) {
  let stored = saved;
  const storage = { get: () => stored, set: (value: string | null) => { stored = value; } };
  const api = { prepare: vi.fn<ScansApi["prepare"]>(async () => request),
    status: vi.fn<ScansApi["status"]>(async () => null),
    submit: vi.fn<ScansApi["submit"]>(async () => ({ jobId: "job-1", merged: false })),
    job: vi.fn<ScansApi["job"]>(async () => job("running")) };
  const state = new LocalScanState(api as unknown as ScansApi, "local", storage, vi.fn());
  return { state, api, storage };
}
afterEach(() => vi.useRealTimers());

describe("Automatic scans after applying directory settings", () => {
  it("starts immediately using fresh provider settings after an automatic request", async () => {
    vi.useFakeTimers();
    const { state, api } = fixture();
    const detach = state.attach();
    api.prepare.mockResolvedValueOnce({ ...request, rootIds: ["new-root"], schemaRevision: "v6" });
    state.requestAutomatic();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.submit).toHaveBeenCalledExactlyOnceWith("local", { ...request, rootIds: ["new-root"], schemaRevision: "v6" }, expect.any(String), expect.any(AbortSignal));
    expect(state.value).toMatchObject({ pending: true, automaticQueued: false, job: { status: "running" } });
    detach();
  });
  it("coalesces configuration changes during an active job into one subsequent fresh scan", async () => {
    vi.useFakeTimers();
    const { state, api, storage } = fixture();
    const detach = state.attach();
    await state.start();
    state.requestAutomatic();
    state.requestAutomatic();
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get()!).automatic).toBe(true);
    api.job.mockResolvedValueOnce(job("failed"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.value.automaticQueued).toBe(true);
    api.prepare.mockResolvedValueOnce({ ...request, schemaRevision: "v6" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.submit).toHaveBeenCalledTimes(2);
    expect(api.submit.mock.calls[1][1].schemaRevision).toBe("v6");
    expect(api.submit.mock.calls[1][2]).not.toBe(api.submit.mock.calls[0][2]);
    expect(state.value.automaticQueued).toBe(false);
    detach();
  });
  it("preserves a configuration change that arrives while a request is being prepared", async () => {
    vi.useFakeTimers();
    const { state, api } = fixture();
    const detach = state.attach();
    await vi.advanceTimersByTimeAsync(0);
    let resolve!: (request: ScanRequest) => void;
    api.prepare.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    state.requestAutomatic();
    state.requestAutomatic();
    resolve(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.value.automaticQueued).toBe(true);
    api.job.mockResolvedValueOnce(job("succeeded"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.submit).toHaveBeenCalledTimes(2);
    detach();
  });
  it("waits for the source to become ready before submitting a new scan", async () => {
    vi.useFakeTimers();
    const { state, api, storage } = fixture();
    const detach = state.attach();
    api.prepare.mockRejectedValueOnce(new ApiError("SOURCE_UNAVAILABLE", "Source is applying settings"));
    state.requestAutomatic();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.submit).not.toHaveBeenCalled();
    expect(JSON.parse(storage.get()!).automatic).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.submit).toHaveBeenCalledTimes(1);
    detach();
  });
  it("restores a queued rescan across refresh and confirms the old job before submitting", async () => {
    vi.useFakeTimers();
    const first = fixture();
    await first.state.start();
    first.state.requestAutomatic();
    const next = fixture(first.storage.get());
    next.api.job.mockResolvedValueOnce(job("paused"));
    const detach = next.state.attach();
    await vi.advanceTimersByTimeAsync(0);
    expect(next.api.submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(next.api.submit).toHaveBeenCalledTimes(1);
    expect(next.state.value.automaticQueued).toBe(false);
    detach();
  });
  it("restores an automatic request that was waiting for provider readiness", async () => {
    vi.useFakeTimers();
    const { state, api } = fixture(JSON.stringify({ pending: null, automatic: true }));
    const detach = state.attach();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.prepare).toHaveBeenCalledTimes(1);
    expect(api.submit).toHaveBeenCalledTimes(1);
    detach();
  });
});
