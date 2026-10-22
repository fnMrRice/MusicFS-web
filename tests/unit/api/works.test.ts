import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { WorksApi, type Work } from "../../../src/api/works";

const work: Work = {
  workId: "work/id", contentType: "asmr", title: "夜间音声", description: "", externalIds: [], credits: [], tags: [],
  revision: 3, createdAt: "2026-10-22T01:00:00Z", updatedAt: "2026-10-22T02:00:00Z",
};
const response = (value: unknown) => new Response(JSON.stringify(value));

describe("Work metadata API", () => {
  it("encodes filters and cursors while omitting empty values", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ items: [work], nextAfter: null }));
    const api = new WorksApi(new ApiClient(fetcher));
    await api.list({ contentType: "asmr", q: "声音 & 夜间", tag: "", credit: "朗读者" }, "opaque+/=");
    const url = new URL(fetcher.mock.calls[0][0], "https://example.test");
    expect(url.searchParams.get("q")).toBe("声音 & 夜间");
    expect(url.searchParams.get("credit")).toBe("朗读者");
    expect(url.searchParams.get("after")).toBe("opaque+/=");
    expect(url.searchParams.has("tag")).toBe(false);
  });
  it("uses caller-owned retry keys and updates only mutable fields at the observed revision", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(work));
    const client = new ApiClient(fetcher);
    client.csrfToken = "csrf";
    const api = new WorksApi(client);
    const fields = { title: "新标题", description: "", externalIds: [], credits: [], tags: [] };
    await api.update(work, fields, "stable-key");
    const [path, options] = fetcher.mock.calls[0];
    expect(path).toBe("/api/v1/works/work%2Fid");
    expect(options.headers.get("Idempotency-Key")).toBe("stable-key");
    expect(options.headers.get("X-CSRF-Token")).toBe("csrf");
    expect(JSON.parse(options.body)).toEqual({ ...fields, expectedRevision: 3 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects malformed work payloads and another work's detail", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ ...work, credits: null }))
      .mockResolvedValueOnce(response(work));
    const api = new WorksApi(new ApiClient(fetcher));
    await expect(api.get(work.workId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.get("another-id")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("accepts unknown stored content types and declarative roles without assuming ASMR fields", async () => {
    const custom = { id: "spoken", pluginId: "example.spoken", pluginVersion: "1.0.0", name: "演播",
      description: "", creditRoles: [{ id: "reader", name: "朗读者" }], externalIdNamespaces: [], views: ["work-detail"] };
    const api = new WorksApi(new ApiClient(vi.fn().mockResolvedValueOnce(response({ items: [custom] }))
      .mockResolvedValueOnce(response({ ...work, contentType: "unavailable" }))));
    expect((await api.types())[0].creditRoles[0].id).toBe("reader");
    expect((await api.get(work.workId)).contentType).toBe("unavailable");
  });
});
