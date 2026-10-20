import { instanceIds } from "../../fixtures/plugins";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { DirectoriesApi } from "../../../src/api/directories";

describe("Administrator directory API", () => {
  it("encodes Windows paths and pagination without exposing them outside the administrator endpoint", async () => {
    const fetcher = vi.fn(async () => new Response("{}"));
    const api = new DirectoriesApi(new ApiClient(fetcher), instanceIds.local);
    await api.browse("E:\\Music\\收藏 & Live", "opaque+/=cursor");
    const [path] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    const url = new URL(path, "https://musicfs.test");
    expect(url.pathname).toBe(`/api/v1/admin/plugin-instances/${instanceIds.local}/directories`);
    expect(url.searchParams.get("path")).toBe("E:\\Music\\收藏 & Live");
    expect(url.searchParams.get("cursor")).toBe("opaque+/=cursor");
    await api.browse(null, null);
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[1][0]).not.toContain("path=");
  });

  it("saves only selected music roots with CSRF, opaque revision and a stable retry key", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 202 }));
    const client = new ApiClient(fetcher);
    client.csrfToken = "csrf-test";
    const api = new DirectoriesApi(client, instanceIds.local);
    const importDefaults = { recursive: true, maxDepth: 0, importLyrics: true, excludePatterns: ["private/**"], skipHidden: true, respectNoMedia: true };
    await api.save([{ id: "old", name: "Existing" }, { id: "new", name: "New", path: "/music/new" }], importDefaults, "opaque-revision", "retry-key");
    const [path, options] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    expect(path).toBe(`/api/v1/admin/plugin-instances/${instanceIds.local}/configuration`);
    expect(options.method).toBe("PUT");
    const headers = new Headers(options.headers);
    expect(headers.get("If-Match")).toBe("opaque-revision");
    expect(headers.get("Idempotency-Key")).toBe("retry-key");
    expect(headers.get("X-CSRF-Token")).toBe("csrf-test");
    expect(JSON.parse(String(options.body))).toEqual({ musicRoots: [
      { id: "old", name: "Existing" }, { id: "new", name: "New", path: "/music/new" },
    ], importDefaults });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
