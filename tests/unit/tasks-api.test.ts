import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/client";
import { TasksApi } from "../../src/api/tasks";
import { refreshTask } from "../fixtures/tasks";

function fixture(value: unknown) {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(value));
  const client = new ApiClient(fetcher); client.csrfToken = "csrf";
  return { fetcher, api: new TasksApi(client) };
}
describe("task API", () => {
  it("requests one scoped page with opaque cursors and full-scope active count", async () => {
    const { api, fetcher } = fixture({ items: [refreshTask()], nextCursor: "next", activeCount: 102 });
    expect((await api.list("mine", "cursor /+" )).activeCount).toBe(102);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/tasks?scope=mine&limit=50&cursor=cursor+%2F%2B");
  });
  it("cancels with CSRF and selected scope and reads tasks without submitting scans", async () => {
    const { api, fetcher } = fixture(refreshTask({ id: "task /1", status: "cancelled", phase: "finished", cancellable: false }));
    await api.cancel("task /1", "all");
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/tasks/task%20%2F1/cancel?scope=all");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", body: "{}" });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("X-CSRF-Token")).toBe("csrf");
    await api.get("task /1", "mine");
    expect(fetcher.mock.calls[1][0]).toBe("/api/v1/tasks/task%20%2F1?scope=mine");
  });
  it.each([{}, { items: [], nextCursor: null }, { items: [], nextCursor: "", activeCount: 0 },
    { items: [refreshTask({ roots: [{ id: "wrong", name: "Wrong" }] })], nextCursor: null, activeCount: 1 },
    { items: [refreshTask({ progress: { observed: -1, metadataTotal: 0, metadataCompleted: 0 } })], nextCursor: null, activeCount: 1 },
  ])("rejects invalid task lists", async value => {
    await expect(fixture(value).api.list("mine")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects another task returned for cancellation", async () => {
    await expect(fixture(refreshTask()).api.cancel("another", "mine")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
