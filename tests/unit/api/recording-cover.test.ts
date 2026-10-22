import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { RecordingCoverApi, type RecordingCover } from "../../../src/api/recording-cover";

const selection: RecordingCover = { recordingId: "recording/中文", revision: 3, coverObjectId: "large", manualObjectId: null,
  candidates: [{ objectId: "large", sourceTrackId: "one", providerInstanceId: "local", width: 1200, height: 1200 },
    { objectId: "old", sourceTrackId: "two", providerInstanceId: "other", width: 0, height: 0 }] };
const create = (response: unknown) => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response)));
  const client = new ApiClient(fetcher); client.csrfToken = "csrf";
  return { fetcher, api: new RecordingCoverApi(client) };
};

describe("Recording artwork API", () => {
  it("reads opaque recording identities and preserves historical unknown dimensions", async () => {
    const { api, fetcher } = create(selection);
    const result = await api.get(selection.recordingId);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/recordings/recording%2F%E4%B8%AD%E6%96%87/cover");
    expect(result).toEqual(selection);
  });

  it.each(["old", null])("saves a manual or automatic choice with revision and retry identity: %s", async (objectId) => {
    const { api, fetcher } = create({ ...selection, manualObjectId: objectId, coverObjectId: objectId || "large", revision: 4 });
    await api.select(selection.recordingId, 3, objectId, "stable-key");
    const init = fetcher.mock.calls[0][1]!;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ expectedRevision: 3, objectId });
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("stable-key");
    expect(init.credentials).toBe("same-origin");
  });

  it("allows a stale manual choice while using a current automatic fallback", async () => {
    const { api } = create({ ...selection, manualObjectId: "gone" });
    expect((await api.get(selection.recordingId)).manualObjectId).toBe("gone");
  });

  it.each([
    { recordingId: "another" }, { revision: -1 }, { revision: 1.2 }, { manualObjectId: undefined },
    { coverObjectId: "not-a-candidate" }, { candidates: [selection.candidates[0], selection.candidates[0]] },
    { candidates: [{ ...selection.candidates[0], width: -1 }] },
    { candidates: [{ ...selection.candidates[0], height: "1200" }] },
  ])("rejects invalid scope, revisions and candidates: %j", async (patch) => {
    const { api } = create({ ...selection, ...patch });
    await expect(api.get(selection.recordingId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("passes conflicts through without automatically repeating the write", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: "CONFLICT" } }), { status: 409 }));
    const api = new RecordingCoverApi(new ApiClient(fetcher));
    await expect(api.select(selection.recordingId, 3, "old", "key")).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
