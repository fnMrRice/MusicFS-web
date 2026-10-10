import { describe, expect, it } from "vitest";
import { musicSources } from "../../src/components/music-sources";
import type { OnlineInstance } from "../../src/api/content";
import type { Provider } from "../../src/api/types";

describe("Unified music sources", () => {
  it("uses feature declarations, merges instance identities, and keeps unknown metadata visible", () => {
    const provider: Provider = { id: "local", name: "Private alias", availability: "available", capabilities: [],
      plugin: { id: "arbitrary.plugin", name: "Folder music", localizedNames: {}, features: ["music-source"] } };
    const online: OnlineInstance = { ...provider, instanceId: "shared", platform: "arbitrary", capabilities: [] };
    const sources = musicSources([
      provider, { ...provider, id: "shared" },
      { ...provider, id: "decoder", plugin: { ...provider.plugin!, features: ["decode"] } },
      { ...provider, id: "unknown", plugin: undefined },
    ], [online]);
    expect(sources.map((source) => source.id)).toEqual(["local", "shared", "unknown"]);
    expect(sources[1].online).toBe(online);
    expect(sources[1].provider).toBeUndefined();
  });
});
