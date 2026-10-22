import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { WorkPackagesApi } from "../../../src/api/work-packages";
import { directoryTracks, packageChildren } from "../../../src/features/works/packages/tree";
import { packageFixture, previewFixture } from "../../fixtures/work-packages";
const response = (value: unknown) => new Response(JSON.stringify(value));

describe("Work package API and directory selection", () => {
  it("keeps a caller-owned confirmation key and encodes attachment identities", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(previewFixture())).mockResolvedValueOnce(response(packageFixture()));
    const client = new ApiClient(fetcher); client.csrfToken = "csrf";
    const api = new WorkPackagesApi(client, "one");
    await api.preview({ providerInstanceId: "local", rootId: "root", path: "作品/WAV" });
    await api.confirm("preview-1", "retry-key");
    expect(fetcher.mock.calls[0][1].headers.get("Idempotency-Key")).toBeNull();
    expect(fetcher.mock.calls[1][1].headers.get("Idempotency-Key")).toBe("retry-key");
    expect(fetcher.mock.calls[1][1].headers.get("X-CSRF-Token")).toBe("csrf");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ previewId: "preview-1" });
    expect(api.attachmentURL("package/id", "WAV/说明.txt", true)).toBe("/api/v1/works/one/packages/package%2Fid/attachments/WAV%2F%E8%AF%B4%E6%98%8E.txt?download=1");
  });
  it("rejects wrong work identities, duplicate nodes and disconnected directory cycles", async () => {
    const wrong = packageFixture(); wrong.workId = "another";
    const duplicate = packageFixture(); duplicate.nodes.push(duplicate.nodes[0]);
    const cycle = packageFixture(); cycle.nodes.find((node) => node.nodeId === "WAV")!.parentId = "WAV/特典";
    for (const value of [wrong, duplicate, cycle]) {
      const api = new WorkPackagesApi(new ApiClient(vi.fn().mockResolvedValue(response({ items: [value] }))), "one");
      await expect(api.list()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });
  it("collects recursively in server order and excludes sibling versions and unavailable tracks", () => {
    const children = packageChildren(packageFixture().nodes);
    expect(directoryTracks(children, "WAV").map((value) => value.sourceTrackId)).toEqual(["track-WAV/01.wav", "track-WAV/特典/02.wav"]);
    expect(directoryTracks(children, "MP3").map((value) => value.sourceTrackId)).toEqual(["track-MP3/01.mp3"]);
  });
});
