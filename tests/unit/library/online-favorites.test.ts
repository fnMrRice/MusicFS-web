import { describe, expect, it } from "vitest";
import { onlineFavoriteIndex } from "../../../src/features/useOnlineFavorites";
import { track } from "../../fixtures/dto";
import { musicTrack } from "../../fixtures/music-catalog";

describe("online favorite identities", () => {
  it("matches every saved source in the instance even when a local recording is selected", () => {
    const local = { ...musicTrack(track), trackId: "group", sources: [
      { providerInstanceId: "local", sourceId: "local-file" },
      { providerInstanceId: "netease", sourceId: "101" },
      { providerInstanceId: "netease", sourceId: "102" },
    ] };
    const other = { ...musicTrack(track), trackId: "other", sources: [
      { providerInstanceId: "other-account", sourceId: "101" },
    ] };
    const legacy = { ...musicTrack(track), trackId: "101" };
    expect(onlineFavoriteIndex([local, other, legacy], "netease")).toEqual(new Map([["101", local], ["102", local]]));
    expect(onlineFavoriteIndex([local, other], "other-account")).toEqual(new Map([["101", other]]));
    expect(onlineFavoriteIndex([local], undefined).size).toBe(0);
  });
});
