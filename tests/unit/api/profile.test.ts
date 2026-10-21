import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { ProfileApi } from "../../../src/api/profile";

const profile = { user: { id: "admin", role: "admin" }, nickname: "听歌的人" };
const response = (value: unknown) => new Response(JSON.stringify(value));

describe("Personal profile API", () => {
  it("reads the current account and saves or clears its nickname with CSRF protection", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ ...profile, avatar: null, avatarUploadSupported: false }))
      .mockResolvedValueOnce(response(profile)).mockResolvedValueOnce(response({ ...profile, nickname: null }));
    const client = new ApiClient(fetcher);
    client.csrfToken = "profile-csrf";
    const api = new ProfileApi(client);
    expect(await api.read()).toEqual(profile);
    expect(await api.save("  听歌的人  ")).toEqual(profile);
    expect(await api.save(null)).toEqual({ ...profile, nickname: null });
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(Array(3).fill("/api/v1/me/profile"));
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
    for (const [, options] of fetcher.mock.calls.slice(1)) {
      expect(options.method).toBe("PUT");
      expect(options.headers.get("X-CSRF-Token")).toBe("profile-csrf");
      expect(options.headers.has("Idempotency-Key")).toBe(false);
    }
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ nickname: "  听歌的人  " });
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ nickname: null });
  });

  it.each([
    null, {}, { user: null, nickname: null }, { user: { id: "admin" }, nickname: null },
    { ...profile, user: { id: 1, role: "admin" } }, { ...profile, user: { id: "", role: "admin" } },
    { ...profile, user: { id: "admin", role: 1 } }, { user: profile.user }, { ...profile, nickname: 42 },
  ])("rejects incomplete or malformed responses: %j", async (value) => {
    const api = new ProfileApi(new ApiClient(vi.fn().mockResolvedValue(response(value))));
    await expect(api.read()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("validates save responses and forwards cancellation", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ nickname: "new" }));
    const api = new ProfileApi(new ApiClient(fetcher));
    await expect(api.save("new")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetcher.mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const controller = new AbortController();
    const pending = api.read(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
