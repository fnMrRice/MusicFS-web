import { instanceIds } from "../fixtures/plugins";
import { describe, expect, it } from "vitest";
import { musicSources } from "../../src/components/music-sources";
import type { OnlineInstance } from "../../src/api/content";
import type { Provider } from "../../src/api/types";

describe("Unified music sources", () => {
  it("uses feature declarations, merges instance identities, and keeps unknown metadata visible", () => {
    const provider: Provider = { id: instanceIds.local, name: "Private alias", availability: "available", capabilities: [],
      plugin: { id: "arbitrary.plugin", name: "Folder music", localizedNames: {}, features: ["music-source"] } };
    const online: OnlineInstance = { ...provider, instanceId: instanceIds.custom, platform: "arbitrary", capabilities: [] };
    const sources = musicSources([
      provider, { ...provider, id: instanceIds.custom },
      { ...provider, id: instanceIds.ffmpeg, plugin: { ...provider.plugin!, features: ["decode"] } },
      { ...provider, id: instanceIds.unknown, plugin: undefined },
    ], [online]);
    expect(sources.map((source) => source.id)).toEqual([instanceIds.local, instanceIds.custom, instanceIds.unknown]);
    expect(sources[1].online).toBe(online);
    expect(sources[1].provider).toBeUndefined();
  });
});
