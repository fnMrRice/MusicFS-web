import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/client";
import type { PluginOperation } from "../../src/api/directories";
import { ConfigurationScans } from "../../src/library/configuration-scans";

const operation = (status: PluginOperation["status"]): PluginOperation => ({ operationId: "op-1", status, errorCode: null });
function fixture(entries: [string, string][] = []) {
  const stored = new Map(entries);
  const storage = {
    get length() { return stored.size; }, key: (index: number) => [...stored.keys()][index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(operation("succeeded")));
  const scan = vi.fn();
  const queue = new ConfigurationScans(new ApiClient(fetcher), scan, storage);
  return { queue, fetcher, scan, stored };
}
afterEach(() => vi.useRealTimers());

describe("Scans waiting for saved directory operations", () => {
  it("scans once when an accepted operation already succeeded", () => {
    const { queue, scan, stored } = fixture();
    queue.setSession("server", "user");
    queue.watch("local", operation("succeeded"));
    queue.watch("local", operation("succeeded"));
    expect(scan).toHaveBeenCalledExactlyOnceWith("local");
    expect(stored.size).toBe(0);
    queue.clear();
  });
  it("waits across applying and draining, independent of the directory view", async () => {
    vi.useFakeTimers();
    const { queue, fetcher, scan, stored } = fixture();
    fetcher.mockResolvedValueOnce(Response.json(operation("draining")));
    queue.setSession("server", "user");
    queue.watch("local", operation("applying"));
    expect(stored.size).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).not.toHaveBeenCalled();
    queue.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledExactlyOnceWith("local");
    expect(stored.size).toBe(0);
    queue.clear();
  });
  it.each(["failed", "superseded"] as const)("never scans after a %s operation", async (status) => {
    vi.useFakeTimers();
    const { queue, fetcher, scan, stored } = fixture();
    fetcher.mockResolvedValueOnce(Response.json(operation(status)));
    queue.setSession("server", "user");
    queue.watch("local", operation("applying"));
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
    queue.clear();
  });
  it("restores only the persisted add/edit scan intent for the current session", async () => {
    vi.useFakeTimers();
    const saved = JSON.stringify({ instance: "local", operationId: "op-1" });
    const { queue, scan, stored } = fixture([
      ["musicfs:server:user:scan-configuration:op-1", saved],
      ["musicfs:server:user:directories:local", "remove-operation"],
      ["musicfs:server:someone:scan-configuration:op-1", saved],
    ]);
    queue.setSession("server", "user");
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledExactlyOnceWith("local");
    expect(stored.size).toBe(2);
    queue.clear();
  });
  it("keeps the saved intent after a network error and stops on logout", async () => {
    vi.useFakeTimers();
    const { queue, fetcher, scan, stored } = fixture();
    fetcher.mockRejectedValueOnce(new TypeError("Offline"));
    queue.setSession("server", "user");
    queue.watch("local", operation("applying"));
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).not.toHaveBeenCalled();
    expect(stored.size).toBe(1);
    queue.clear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stored.size).toBe(1);
  });
});
