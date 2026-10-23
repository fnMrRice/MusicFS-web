import { afterEach, describe, expect, it, vi } from "vitest";
import type { TasksApi, RefreshTask } from "../../src/api/tasks";
import { TaskQueueState } from "../../src/tasks/task-queue-state";
import { refreshTask } from "../fixtures/tasks";

const states: TaskQueueState[] = [];
function fixture(items: RefreshTask[] = [refreshTask()]) {
  vi.useFakeTimers();
  const api = { list: vi.fn().mockResolvedValue({ items, nextCursor: null, activeCount: 1 }), cancel: vi.fn() };
  const finished = vi.fn();
  const state = new TaskQueueState(api as unknown as TasksApi, finished); states.push(state);
  return { api, state, finished };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { states.splice(0).forEach(state => state.clear()); vi.useRealTimers(); });
describe("global task queue", () => {
  it("restores server tasks, polls metadata until terminal, and reports completion once", async () => {
    const { api, state, finished } = fixture([refreshTask({ status: "running", phase: "metadata" })]);
    state.start(false); await settle();
    expect(state.value.items[0].phase).toBe("metadata");
    api.list.mockResolvedValue({ items: [refreshTask({ status: "succeeded", phase: "finished" })], nextCursor: null, activeCount: 0 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.value.activeCount).toBe(0); expect(finished).toHaveBeenCalledTimes(1);
    await state.refresh(); expect(finished).toHaveBeenCalledTimes(1);
  });
  it("defaults to mine and prevents non-admin all requests", async () => {
    const { api, state } = fixture(); state.start(false); await settle(); state.setScope("all");
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list.mock.calls[0][0]).toBe("mine"); expect(state.value.scope).toBe("mine");
  });
  it("drops stale mine responses after an admin switches scope", async () => {
    const { api, state } = fixture(); let resolve!: (value: unknown) => void;
    api.list.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    state.start(true); const signal = api.list.mock.calls[0][2];
    state.setScope("all"); await settle();
    resolve({ items: [refreshTask({ id: "stale" })], nextCursor: null, activeCount: 7 }); await settle();
    expect(signal.aborted).toBe(true); expect(state.value.scope).toBe("all"); expect(state.value.items[0].id).toBe("task-1");
  });
  it("loads further pages, deduplicates overlap, and keeps scope-wide count", async () => {
    const { api, state } = fixture();
    api.list.mockImplementation(async (_scope, cursor) => cursor
      ? { items: [refreshTask(), refreshTask({ id: "task-2" })], nextCursor: null, activeCount: 72 }
      : { items: [refreshTask()], nextCursor: "next", activeCount: 72 });
    state.start(true); await settle(); await state.more();
    expect(state.value.items.map(task => task.id)).toEqual(["task-1", "task-2"]);
    expect(state.value.activeCount).toBe(72);
    await state.refresh(); expect(api.list.mock.calls.at(-1)?.[1]).toBe("next");
  });
  it("cancels in selected scope and does not restart cancelled tasks", async () => {
    const { api, state, finished } = fixture(); state.start(true); await settle(); state.setScope("all"); await settle();
    const cancelled = refreshTask({ status: "cancelled", phase: "finished", cancellable: false });
    api.cancel.mockResolvedValue(cancelled); api.list.mockResolvedValue({ items: [cancelled], nextCursor: null, activeCount: 0 });
    await state.cancel("task-1"); await settle();
    expect(api.cancel.mock.calls[0].slice(0, 2)).toEqual(["task-1", "all"]);
    expect(state.value.items[0].status).toBe("cancelled"); expect(finished).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8000); expect(api.cancel).toHaveBeenCalledTimes(1);
  });
  it("keeps cancellation errors on their task and clears requests on logout", async () => {
    const { api, state } = fixture(); state.start(false); await settle();
    api.cancel.mockRejectedValue(new Error("Offline")); await state.cancel("task-1");
    expect(state.value.cancelErrors["task-1"]).toBeTruthy();
    state.clear(); const calls = api.list.mock.calls.length; await vi.advanceTimersByTimeAsync(10000);
    expect(api.list).toHaveBeenCalledTimes(calls); expect(state.value.items).toEqual([]);
  });
});
