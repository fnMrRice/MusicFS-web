import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/client";
import { LibraryApi } from "../../src/api/library";
import { ScansApi } from "../../src/api/scans";

const provider = { id: "local /1", name: "Local", capabilities: ["library.scan"], availability: "available",
  configuration: { schemaRevision: "local-import-v5" }, roots: [{ id: "one", name: "One" }, { id: "two", name: "Two" }] };
const body = { mode: "full", schemaRevision: "local-import-v5", rootIds: ["one", "two"], options: {} } as const;
const job = { jobId: "job /1", providerInstanceId: provider.id, status: "running", complete: false,
  progress: { observed: 2 }, error: null };
function fixture() {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [provider] }));
  const client = new ApiClient(fetcher); client.csrfToken = "csrf-token";
  return { api: new ScansApi(client, new LibraryApi(client)), fetcher };
}

describe("Scan API", () => {
  it("refreshes only the selected saved root without changing its configuration", async () => {
    const { api, fetcher } = fixture();
    expect(await api.prepare(provider.id, undefined, "two")).toEqual({ ...body, rootIds: ["two"], options: { refreshMetadata: true } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(api.prepare(provider.id, undefined, "removed")).rejects.toMatchObject({ code: "RESOURCE_CHANGED" });
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("uses the latest provider schema and every root without overriding directory options", async () => {
    const { api, fetcher } = fixture();
    expect(await api.prepare(provider.id)).toEqual(body);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/provider-instances", expect.anything());
    fetcher.mockResolvedValueOnce(Response.json({ items: [{ ...provider, configuration: { schemaRevision: "new-revision" }, roots: [provider.roots[1]] }] }));
    expect(await api.prepare(provider.id)).toEqual({ ...body, schemaRevision: "new-revision", rootIds: ["two"] });
  });
  it.each([
    { items: [] },
    { items: [{ ...provider, availability: "offline" }] },
    { items: [{ ...provider, roots: [] }] },
    { items: [{ ...provider, configuration: null }] },
    { items: [{ ...provider, capabilities: [] }] },
  ])("refuses an unavailable scan configuration without posting", async (response) => {
    const { api, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(Response.json(response));
    await expect(api.prepare(provider.id)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
  });
  it("encodes routes and sends CSRF and the caller's idempotency key", async () => {
    const { api, fetcher } = fixture();
    const request = await api.prepare(provider.id);
    fetcher.mockResolvedValueOnce(Response.json({ jobId: "job /1", merged: true }));
    expect(await api.submit(provider.id, request, "stable-key")).toEqual({ jobId: "job /1", merged: true });
    const [url, options] = fetcher.mock.calls[1];
    expect(url).toBe("/api/v1/provider-instances/local%20%2F1/scan-jobs");
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect(new Headers(options?.headers).get("Idempotency-Key")).toBe("stable-key");
    expect(JSON.parse(options?.body as string)).toEqual(body);
    fetcher.mockResolvedValueOnce(Response.json(job));
    expect(await api.job(job.jobId, provider.id)).toEqual(job);
    expect(fetcher.mock.calls[2][0]).toBe("/api/v1/scan-jobs/job%20%2F1");
  });
  it.each([
    { ...job, jobId: "another-job" }, { ...job, providerInstanceId: "another-provider" },
    { ...job, status: "unknown" }, { ...job, complete: undefined },
    { ...job, progress: { observed: -1 } }, { ...job, progress: { observed: 1, total: "10" } },
  ])("rejects malformed or mismatched job data", async (response) => {
    const { api, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(Response.json(response));
    await expect(api.job(job.jobId, provider.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects malformed acceptance without claiming success", async () => {
    const { api, fetcher } = fixture();
    const request = await api.prepare(provider.id);
    fetcher.mockResolvedValueOnce(Response.json({ status: "queued" }));
    await expect(api.submit(provider.id, request, "key")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
