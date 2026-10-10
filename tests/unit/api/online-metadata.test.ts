import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { ContentApi, type OnlineInstance } from "../../../src/api/content";

const instance: OnlineInstance = {
  instanceId: "private-instance", name: "Private alias", platform: "custom",
  plugin: { id: "example.custom", name: "Custom Music", localizedNames: {}, features: ["music-source"] },
  availability: "available", capabilities: [],
};
const response = (items: OnlineInstance[]) => new Response(JSON.stringify({ items }));

describe("Online metadata is scoped to the authenticated client", () => {
  it("clears metadata at session boundaries and ignores late results from the previous session", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response([instance]))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const api = new ContentApi(new ApiClient(fetcher));
    await api.online();
    expect(api.onlineInstances.value).toEqual([instance]);
    expect(new ContentApi(new ApiClient(fetcher)).onlineInstances.value).toEqual([]);
    const stale = api.online();
    api.clearOnlineInstances();
    finish(response([instance]));
    await stale;
    expect(api.onlineInstances.value).toEqual([]);
  });

  it("keeps the newest response and removes metadata omitted by the server", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(response([{ ...instance, plugin: undefined, availability: "offline" }]));
    const api = new ContentApi(new ApiClient(fetcher));
    const stale = api.online();
    await api.online();
    finish(response([instance]));
    await stale;
    expect(api.onlineInstances.value[0].plugin).toBeUndefined();
    expect(api.onlineInstances.value[0].availability).toBe("offline");
  });
});
