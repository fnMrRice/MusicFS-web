import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import type { DirectoriesApi, RootStatistic } from "../../src/api/directories";
import { directorySize, RootStatisticsState } from "../../src/library/root-statistics";

const roots = [{ rootId: "music", trackCount: 946, sizeBytes: 12 * 1024 ** 3 }];
describe("Directory statistics", () => {
  it("keeps unknown distinct from zero and retains the last success while refreshing or failing", async () => {
    const api = { rootStatistics: vi.fn<DirectoriesApi["rootStatistics"]>(async () => roots) };
    const state = new RootStatisticsState(api);
    expect(state.value).toEqual({ data: null, loading: true, error: null });
    await state.refresh();
    let resolve!: (value: RootStatistic[]) => void;
    api.rootStatistics.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const refresh = state.refresh();
    expect(state.value).toEqual({ data: roots, loading: true, error: null });
    resolve([]);
    await refresh;
    expect(state.value.data).toEqual([]);
    api.rootStatistics.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Disconnected"));
    await state.refresh();
    expect(state.value.data).toEqual([]);
    expect(state.value.error).toBeTruthy();
    await state.refresh();
    expect(state.value).toEqual({ data: roots, loading: false, error: null });
  });

  it("ignores superseded requests and results from a detached session", async () => {
    const pending: ((value: RootStatistic[]) => void)[] = [];
    const api = { rootStatistics: vi.fn<DirectoriesApi["rootStatistics"]>(() => new Promise((done) => pending.push(done))) };
    const state = new RootStatisticsState(api);
    const first = state.refresh();
    const second = state.refresh();
    expect(api.rootStatistics.mock.calls[0][0]?.aborted).toBe(true);
    pending[1]([]);
    await second;
    pending[0](roots);
    await first;
    expect(state.value.data).toEqual([]);
    const detached = state.refresh();
    state.detach();
    pending[2](roots);
    await detached;
    expect(state.value.data).toEqual([]);
  });

  it.each([[0, '0 B'], [1024, '1.0 KiB'], [1024 ** 2, '1.0 MiB'],
    [Math.round(12.3 * 1024 ** 3), '12.3 GiB'], [1024 ** 4, '1.0 TiB']])(
    'formats %d bytes with a suitable capacity unit', (bytes, expected) => {
      expect(directorySize(Number(bytes))).toBe(expected);
    },
  );
});
