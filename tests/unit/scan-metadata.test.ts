import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/client";
import { scanMetadataResults } from "../../src/api/scan-metadata";

const result = (triggerId: string, state = "completed", actions: { field: string; status: string; reason: string }[] = []) => ({
  triggerId, scanJobId: "scan /1", reason: "refreshMetadata", state, failureCode: null, actions,
});
const action = (status: string, reason = status) => ({ field: "artwork", status, reason });

describe("Scan metadata results", () => {
  it("checks every page, counts actual actions, and keeps running tasks pending", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [result("one", "completed", [action("applied")])], nextCursor: "next /page" }))
      .mockResolvedValueOnce(Response.json({ items: [result("two", "running"), result("three", "completed", [action("skipped", "manualLocked")])], nextCursor: null }));
    expect(await scanMetadataResults(new ApiClient(fetcher), "scan /1")).toEqual({
      total: 3, completed: 2, applied: 1, skipped: 1, failed: 0, pending: true,
    });
    expect(fetcher.mock.calls[1][0]).toBe("/api/v1/scan-jobs/scan%20%2F1/metadata-results?limit=200&cursor=next+%2Fpage");
  });
  it("reports failed actions even in a completed task and counts each failed track once", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [
      result("one", "completed", [action("failed"), action("failed")]),
      { ...result("two", "failed"), failureCode: "SOURCE_OFFLINE" },
      { ...result("other", "running"), reason: "automatic" },
    ], nextCursor: null }));
    expect(await scanMetadataResults(new ApiClient(fetcher), "scan /1")).toMatchObject({ total: 2, completed: 2, failed: 2, pending: false });
  });
  it.each(["failed", "skipped"])("finishes a %s task even if an interrupted action remains pending", async (state) => {
    const client = new ApiClient(async () => Response.json({ items: [result("one", state, [action("pending")])], nextCursor: null }));
    expect(await scanMetadataResults(client, "scan /1")).toMatchObject({
      total: 1, completed: 1, failed: state === "failed" ? 1 : 0, pending: false,
    });
  });
  it.each([
    { items: [result("one", "unknown")], nextCursor: null },
    { items: [{ ...result("one"), scanJobId: "another-scan" }], nextCursor: null },
    { items: [result("one", "completed", [action("unknown")])], nextCursor: null },
    { items: [], nextCursor: "" },
  ])("rejects invalid results instead of showing success", async (page) => {
    const client = new ApiClient(async () => Response.json(page));
    await expect(scanMetadataResults(client, "scan /1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects repeated cursors without polling forever", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [], nextCursor: "loop" }));
    await expect(scanMetadataResults(new ApiClient(fetcher), "scan /1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
