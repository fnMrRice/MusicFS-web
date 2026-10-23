import { instanceIds } from "../../fixtures/plugins";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { DirectoriesApi } from "../../../src/api/directories";

describe("Administrator directory API", () => {
  it("reads statistics from the provider endpoint without submitting or exposing paths", async () => {
    const roots = [{ rootId: 'music', trackCount: 946, sizeBytes: 12 * 1024 ** 3 }];
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ roots }));
    const api = new DirectoriesApi(new ApiClient(fetcher), 'local /1');
    expect(await api.rootStatistics()).toEqual(roots);
    const [path, options] = fetcher.mock.calls[0];
    expect(path).toBe('/api/v1/provider-instances/local%20%2F1/root-statistics');
    expect(options?.method).toBe('GET');
    expect(options?.body).toBeUndefined();
    fetcher.mockResolvedValueOnce(Response.json({ roots: [] }));
    expect(await api.rootStatistics()).toEqual([]);
  });
  it.each([{}, { roots: null }, { roots: [{ rootId: '', trackCount: 1, sizeBytes: 1 }] },
    { roots: [{ rootId: 'music', trackCount: -1, sizeBytes: 1 }] },
    { roots: [{ rootId: 'music', trackCount: 1, sizeBytes: Number.MAX_SAFE_INTEGER + 1 }] },
    { roots: [{ rootId: 'music', trackCount: 1, sizeBytes: 1.5 }] },
    { roots: [{ rootId: 'music', trackCount: 1, sizeBytes: 1 }, { rootId: 'music', trackCount: 1, sizeBytes: 1 }] },
  ])('rejects invalid or duplicate root statistics', async (value) => {
    const api = new DirectoriesApi(new ApiClient(async () => Response.json(value)), 'local');
    await expect(api.rootStatistics()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
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
    const importDefaults = { recursive: true, maxDepth: 0, importLyrics: true, importArtwork: true, excludePatterns: ["private/**"], skipHidden: true, respectNoMedia: true };
    const rootOptions = { ...importDefaults, recursive: false, skipHidden: false };
    await api.save([{ id: "old", name: "Existing", importDefaults: rootOptions }, { id: "new", name: "New", path: "/music/new" }], importDefaults, "opaque-revision", "retry-key");
    const [path, options] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    expect(path).toBe(`/api/v1/admin/plugin-instances/${instanceIds.local}/configuration`);
    expect(options.method).toBe("PUT");
    const headers = new Headers(options.headers);
    expect(headers.get("If-Match")).toBe("opaque-revision");
    expect(headers.get("Idempotency-Key")).toBe("retry-key");
    expect(headers.get("X-CSRF-Token")).toBe("csrf-test");
    expect(JSON.parse(String(options.body))).toEqual({ musicRoots: [
      { id: "old", name: "Existing", importDefaults: rootOptions }, { id: "new", name: "New", path: "/music/new" },
    ], importDefaults });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([undefined, false])("keeps omitted or disabled artwork import off while saving other settings (%s)", async (importArtwork) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("{}", { status: 202 }));
    const api = new DirectoriesApi(new ApiClient(fetcher), instanceIds.local);
    const options = { recursive: false, maxDepth: 0, importLyrics: false, excludePatterns: [], skipHidden: true, respectNoMedia: true,
      ...(importArtwork === undefined ? {} : { importArtwork }) };
    await api.save([{ id: "changed", name: "Edited", importDefaults: options }, { id: "unchanged", name: "Existing" }], options, "revision", "stable-key");
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.importDefaults.importArtwork).toBe(false);
    expect(body.musicRoots[0].importDefaults.importArtwork).toBe(false);
    expect(body.musicRoots[1]).toEqual({ id: "unchanged", name: "Existing" });
    expect(options).not.toHaveProperty("importArtwork", true);
  });
});
