import { afterEach, describe, expect, it, vi } from "vitest";
import { ScansApi, type ScanJob, type ScanRequest } from "../../src/api/scans";
import { LocalScans } from "../../src/library/local-scans";

const request: ScanRequest = { mode: "full", schemaRevision: "v5", rootIds: ["one"], options: {} };
const job = (status: ScanJob["status"]): ScanJob => ({ jobId: "job-1", providerInstanceId: "local", status,
  complete: status === "succeeded", progress: { observed: 2 }, error: null });
function fixture(entries: [string, string][] = []) {
  const stored = new Map(entries);
  const storage = {
    get length() { return stored.size; }, key: (index: number) => [...stored.keys()][index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  };
  const api = { prepare: vi.fn<ScansApi["prepare"]>(async () => request),
    submit: vi.fn<ScansApi["submit"]>(async () => ({ jobId: "job-1", merged: false })),
    job: vi.fn<ScansApi["job"]>(async () => job("running")) };
  const finished = vi.fn();
  const scans = new LocalScans(api as unknown as ScansApi, finished, storage);
  return { scans, api, finished, stored };
}
afterEach(() => vi.useRealTimers());

describe("Session-owned local scans", () => {
  it("continues polling and refreshes the library after the source view unsubscribes", async () => {
    vi.useFakeTimers();
    const { scans, api, finished } = fixture();
    scans.setSession("server", "user");
    const state = scans.get("local");
    const unsubscribe = state.subscribe(() => {});
    await state.start();
    unsubscribe();
    api.job.mockResolvedValueOnce(job("succeeded"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(finished).toHaveBeenCalledExactlyOnceWith("local", true);
    expect(state.value).toMatchObject({ pending: false, job: { status: "succeeded" } });
    expect(scans.get("local")).toBe(state);
    scans.clear();
  });
  it("restores same-server same-user tasks on login without opening the settings view", async () => {
    vi.useFakeTimers();
    const saved = JSON.stringify({ key: "same-key", request, jobId: "job-1" });
    const { scans, api, finished, stored } = fixture([
      ["musicfs:server:user:scan:local", saved],
      ["musicfs:other-server:user:scan:local", saved],
      ["musicfs:server:other-user:scan:local", saved],
    ]);
    scans.setSession("server", "user");
    expect(api.job).toHaveBeenCalledExactlyOnceWith("job-1", "local", expect.any(AbortSignal));
    expect(api.submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    api.job.mockResolvedValueOnce(job("succeeded"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(finished).toHaveBeenCalledExactlyOnceWith("local", true);
    expect(stored.has("musicfs:server:user:scan:local")).toBe(false);
    expect(stored.size).toBe(2);
    scans.clear();
  });
  it("stops timers on logout and cancels in-flight confirmation when the session changes", async () => {
    vi.useFakeTimers();
    const { scans, api, finished, stored } = fixture();
    scans.setSession("server", "user");
    await scans.get("local").start();
    scans.clear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.job).toHaveBeenCalledTimes(1);
    expect(stored.size).toBe(1);
    let resolve!: (job: ScanJob) => void;
    api.job.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    scans.setSession("server", "user");
    const signal = api.job.mock.calls[1][2];
    scans.setSession("server", "other-user");
    expect(signal?.aborted).toBe(true);
    resolve(job("succeeded"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(finished).not.toHaveBeenCalled();
    expect(stored.size).toBe(1);
    scans.clear();
  });
});
