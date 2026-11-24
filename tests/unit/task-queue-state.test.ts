import { afterEach, describe, expect, it, vi } from "vitest";
import type { TasksApi, RefreshTask, Task } from "../../src/api/tasks";
import { TaskQueueState } from "../../src/tasks/task-queue-state";
import { refreshTask } from "../fixtures/tasks";

const running = refreshTask({ status: "running", phase: "metadata" });
const older = refreshTask({ id: "older", createdAt: "2026-10-22T00:00:00Z" });
const done = (task: RefreshTask): RefreshTask => ({ ...task, status: "succeeded", phase: "finished", cancellable: false });
const page = (items: Task[], activeCount: number, nextCursor: string | null = null) => ({ items, nextCursor, activeCount });
function fixture(admin = false) {
  const api = { subscribe: vi.fn().mockResolvedValue(undefined), list: vi.fn(), cancel: vi.fn() };
  const finished = vi.fn();
  const state = new TaskQueueState(api as unknown as TasksApi, finished);
  state.start(admin);
  const id = () => api.subscribe.mock.calls.at(-1)![0];
  const push = (items: Task[], activeCount = 1, cursor: string | null = null, changed: Task[] = [], reset = false) =>
    state.receive({ subscriptionId: id(), page: page(items, activeCount, cursor), changed, reset });
  return { api, state, finished, push, id };
}
afterEach(() => vi.useRealTimers());
describe("global task queue", () => {
  it("refreshes partial catalog results completed between snapshots and outside the visible page", () => {
    const { state, push, finished } = fixture();
    const job: Task = { ...refreshTask(), id: "scrape", kind: "albumAutoScrape", phase: "finished", status: "failed",
      progress: { total: 2, completed: 2 }, result: { updated: 1, retained: 0, notFound: 0, failed: 1 } };
    state.connection(true);
    push([job], 0, null, [], true);
    expect(finished).not.toHaveBeenCalled();
    const fast = { ...job, id: "fast" }, outside = { ...job, id: "outside" };
    push([fast, job], 0, "next", [outside]);
    push([fast, job], 0, "next");
    expect(finished.mock.calls.map(([task]) => task.id).sort()).toEqual(["fast", "outside"]);
    expect(state.value.items).toEqual([fast, job]);
  });
  it("keeps loading through a delayed subscribe response until the first snapshot arrives", async () => {
    const { state, api, push } = fixture();
    let acknowledge!: () => void;
    api.subscribe.mockImplementation(() => new Promise<void>(done => { acknowledge = done; }));
    expect(state.value.loading).toBe(true);
    state.connection(true); expect(state.value.loading).toBe(true);
    acknowledge(); await Promise.resolve();
    expect(state.value.loading).toBe(true);
    push([], 0, null, [], true);
    expect(state.value).toMatchObject({ loading: false, items: [], activeCount: 0 });
  });
  it("subscribes on ready and applies pushed progress and badge counts without listing tasks", async () => {
    vi.useFakeTimers();
    const { api, state, finished, push } = fixture();
    expect(api.subscribe).not.toHaveBeenCalled();
    state.connection(true); push([running], 130, null, [], true);
    expect(api.subscribe).toHaveBeenCalledExactlyOnceWith(expect.any(String), "mine", expect.any(AbortSignal));
    expect(state.value).toMatchObject({ activeCount: 130, items: [running], loading: false });
    await vi.advanceTimersByTimeAsync(60_000);
    push([done(running)], 0); push([done(running)], 0);
    expect(state.value.activeCount).toBe(0);
    expect(finished).toHaveBeenCalledExactlyOnceWith(done(running));
    expect(api.list).not.toHaveBeenCalled();
  });
  it("isolates a subscription by user scope and drops late snapshots", () => {
    const ordinary = fixture(); ordinary.state.connection(true); ordinary.state.setScope("all");
    expect(ordinary.api.subscribe).toHaveBeenCalledTimes(1); expect(ordinary.state.value.scope).toBe("mine");
    const { state, api, push, id } = fixture(true);
    state.connection(true); const mine = id();
    state.setScope("all"); expect(id()).not.toBe(mine);
    expect(api.subscribe.mock.calls[1][1]).toBe("all");
    state.receive({ subscriptionId: mine, page: page([running], 10), changed: [], reset: true });
    expect(state.value.items).toEqual([]);
    push([running], 42);
    state.clear(); state.receive({ subscriptionId: id(), page: page([running], 42), changed: [], reset: false });
    expect(state.value.activeCount).toBe(0);
  });
  it("reads another page only on demand and applies changes beyond the first page", async () => {
    const { state, api, push, finished } = fixture();
    state.connection(true); push([running], 72, "cursor");
    api.list.mockResolvedValue(page([older], 999, "next"));
    await state.more();
    expect(api.list).toHaveBeenCalledExactlyOnceWith("mine", "cursor", expect.any(AbortSignal));
    expect(state.value.activeCount).toBe(72);
    push([running], 71, "cursor", [done(older)]);
    expect(state.value.items).toEqual([running, done(older)]);
    expect(state.value.nextCursor).toBe("next"); expect(finished).toHaveBeenCalledExactlyOnceWith(done(older));
    expect(api.list).toHaveBeenCalledTimes(1);
  });
  it("keeps push updates that arrive during a historical page request", async () => {
    const { state, api, push } = fixture();
    state.connection(true); push([running], 2, "cursor");
    let resolve!: (value: unknown) => void;
    api.list.mockImplementation(() => new Promise(done => { resolve = done; }));
    const more = state.more();
    push([running], 1, "cursor", [done(older)]);
    resolve(page([older], 2));
    await more;
    expect(state.value.items).toEqual([running, done(older)]); expect(state.value.activeCount).toBe(1);
  });
  it("restores expanded history on a fresh subscription and ignores reads from its predecessor", async () => {
    const { state, api, push, id } = fixture();
    state.connection(true); push([running], 2, "cursor");
    let resolve!: (value: unknown) => void;
    api.list.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const oldMore = state.more(), oldId = id();
    state.connection(false); expect(api.list.mock.calls[0][2].aborted).toBe(true);
    state.connection(true); expect(id()).not.toBe(oldId);
    api.list.mockResolvedValue(page([done(older)], 0));
    push([done(running)], 0, "new cursor", [], true);
    resolve(page([older], 8)); await oldMore;
    expect(state.value).toMatchObject({ items: [done(running), done(older)], activeCount: 0, loading: false });
    expect(api.list.mock.calls.map(call => call[1])).toEqual(["cursor", "new cursor"]);
  });
  it("reconciles a reset during load-more and applies a later push over both stale history responses", async () => {
    const { state, api, push } = fixture();
    state.connection(true); push([running], 2, "cursor A", [], true);
    let oldRead!: (value: unknown) => void, newRead!: (value: unknown) => void;
    api.list.mockImplementationOnce(() => new Promise(done => { oldRead = done; }))
      .mockImplementationOnce(() => new Promise(done => { newRead = done; }));
    const more = state.more();
    push([running], 2, "cursor B", [], true);
    expect(api.list.mock.calls[0][2].aborted).toBe(true);
    push([done(running)], 0, "cursor C", [done(older)]);
    newRead(page([running, older], 2, "next")); oldRead(page([older], 2, "stale")); await more;
    expect(state.value).toMatchObject({ items: [done(running), done(older)], activeCount: 0, nextCursor: "next", loading: false });
    expect(api.list.mock.calls.map(call => call[1])).toEqual(["cursor A", "cursor B"]);
  });
  it("keeps displaced first-page items and the historical cursor when a new task joins", async () => {
    const { state, api, push } = fixture();
    state.connection(true); push([running], 2, "head cursor", [], true);
    api.list.mockResolvedValueOnce(page([older], 2, "tail cursor"));
    await state.more();
    const newest = refreshTask({ id: "new", createdAt: "2026-10-24T00:00:00Z" });
    push([newest], 2, "new head cursor", [done(older)]);
    expect(state.value.items).toEqual([newest, running, done(older)]);
    expect(state.value.nextCursor).toBe("tail cursor");
    api.list.mockResolvedValueOnce(page([], 2)); await state.more();
    expect(api.list.mock.calls[1][1]).toBe("tail cursor");
  });
  it("keeps pushed completion when an earlier cancellation response arrives later", async () => {
    const { state, api, push, finished } = fixture();
    state.connection(true); push([running]); let resolve!: (value: unknown) => void;
    api.cancel.mockImplementation(() => new Promise(done => { resolve = done; }));
    const cancelling = state.cancel(running.id);
    expect(state.value.cancelling).toEqual([running.id]);
    const cancelled = { ...running, status: "cancelled", phase: "finished" } as const;
    push([cancelled], 0); resolve({ ...running, status: "cancelling" }); await cancelling;
    expect(state.value).toMatchObject({ items: [cancelled], cancelling: [], activeCount: 0 });
    expect(finished).toHaveBeenCalledOnce(); expect(api.list).not.toHaveBeenCalled();
  });
  it("offers retry after an invalid snapshot and retains per-task cancellation errors", async () => {
    const { state, api, push, id } = fixture();
    state.connection(true); push([running]);
    state.receive({ subscriptionId: id(), page: null, changed: [] });
    expect(state.value.error).toBeTruthy();
    const first = id(); await state.refresh(); expect(id()).not.toBe(first);
    push([running]); api.cancel.mockRejectedValue(new Error("Offline")); await state.cancel(running.id);
    expect(state.value.cancelErrors[running.id]).toBeTruthy();
    state.clear(); expect(state.value.items).toEqual([]);
  });
});
