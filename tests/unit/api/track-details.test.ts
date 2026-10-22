import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, errorMessage } from "../../../src/api/client";
import { TrackDetailsApi, type TrackDetails } from "../../../src/api/track-details";

const details: TrackDetails = {
  sourceTrackId: "track /one", providerInstanceId: "source", externalId: "remote-id", title: "Plugin title",
  sections: [{ id: "custom", title: "Plugin section", fields: [{ id: "catalog", label: "Catalog number", value: "ABC-123" }] }],
};

describe("Plugin source track details", () => {
  it("requests the selected source track and preserves arbitrary plugin text", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(details));
    const result = await new TrackDetailsApi(new ApiClient(fetcher)).get(details.sourceTrackId, "source");
    expect(result).toEqual(details);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/source-tracks/track%20%2Fone/details");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", credentials: "same-origin" });
  });

  it("rejects details for a different source track or provider", async () => {
    for (const changed of [{ sourceTrackId: "another-track" }, { providerInstanceId: "another-source" }]) {
      const api = new TrackDetailsApi(new ApiClient(async () => Response.json({ ...details, ...changed })));
      await expect(api.get(details.sourceTrackId, "source")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("accepts empty details but rejects malformed or ambiguous plugin fields", async () => {
    const api = (sections: unknown) => new TrackDetailsApi(new ApiClient(async () => Response.json({ ...details, sections })));
    await expect(api([]).get(details.sourceTrackId, "source")).resolves.toMatchObject({ sections: [] });
    const section = details.sections[0];
    for (const sections of [null, [null], [section, section], [{ ...section, fields: null }],
      [{ ...section, fields: [section.fields[0], section.fields[0]] }],
      [{ ...section, fields: [{ ...section.fields[0], value: { html: "<b>unsafe</b>" } }] }]]) {
      await expect(api(sections).get(details.sourceTrackId, "source")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("preserves source plugin errors instead of replacing them with library metadata", async () => {
    const api = new TrackDetailsApi(new ApiClient(async () => Response.json({ error: { code: "SOURCE_UNAVAILABLE" } }, { status: 503 })));
    await expect(api.get(details.sourceTrackId, "source")).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", status: 503 });
  });

  it("limits the rescan hint to source-track details while preserving error context", async () => {
    const client = new ApiClient(async () => Response.json({
      error: { code: "RESOURCE_CHANGED", message: "Resource changed", requestId: "trace-id", retryAfter: 5 },
    }, { status: 409 }));
    await expect(new TrackDetailsApi(client).get(details.sourceTrackId, "source")).rejects.toMatchObject({
      code: "SOURCE_TRACK_CHANGED", message: "Resource changed", status: 409, requestId: "trace-id", retryAfter: 5,
    });
    await expect(client.request("/online-instances/source/tracks/123/details")).rejects.toMatchObject({ code: "RESOURCE_CHANGED" });
    expect(errorMessage(new ApiError("SOURCE_TRACK_CHANGED", "Resource changed", 409))).toContain("重新扫描曲库");
    expect(errorMessage(new ApiError("RESOURCE_CHANGED", "Account changed", 409))).not.toContain("重新扫描曲库");
  });

  it("forwards cancellation to the pending request", async () => {
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      signal = options?.signal;
      return new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal?.reason), { once: true }));
    });
    const cancel = new AbortController();
    const pending = new TrackDetailsApi(new ApiClient(fetcher)).get(details.sourceTrackId, "source", cancel.signal);
    cancel.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(signal?.aborted).toBe(true);
  });
});
