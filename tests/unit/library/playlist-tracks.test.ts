import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../../../src/api/client";
import type { PlaylistEntry } from "../../../src/api/content";
import { LibraryApi } from "../../../src/api/library";
import { resolvePlaylistTracks } from "../../../src/features/playlists/playlist-tracks";
import { track } from "../../fixtures/dto";
import { musicTrack } from "../../fixtures/music-catalog";
import { displaySource } from "../../../src/api/music-catalog";

function entry(id: string | null, key = id ?? "remote"): PlaylistEntry {
  return { entryId: key, source: { sourceTrackId: id, remoteSourceId: id ? null : "remote-source" }, provenance: [] };
}
describe("explicit playlist source resolution", () => {
  it("preserves canonical titles and separate choices for repeated entries, including missing pins", async () => {
    const version = { ...track, sourceTrackId: "second", title: "Plugin title", availability: "offline" };
    const music = { ...musicTrack({ ...track, versions: [track, version] }), title: "Canonical title", trackId: "logical" };
    const refs: PlaylistEntry[] = [null, "second", "removed"].map((id, i) => ({
      ...entry(null, String(i)), source: { trackId: "logical", forcedSourceTrackId: id, sourceTrackId: null, remoteSourceId: null },
    }));
    const load = vi.fn().mockResolvedValue(music);
    const result = await resolvePlaylistTracks(refs, vi.fn(), new AbortController().signal, load);
    expect(load).toHaveBeenCalledTimes(1);
    const sources = result.map((e) => e.track && displaySource(e.track));
    expect(sources[0]).toMatchObject({ title: "Canonical title", sourceTrackId: track.sourceTrackId, playbackSelection: { trackId: "logical", forcedSourceTrackId: null } });
    expect(sources[1]).toMatchObject({ title: "Canonical title", sourceTrackId: "second", availability: "offline" });
    expect(sources[2]).toBeNull();
    expect(result.map((e) => e.track && "trackId" in e.track && e.track.playlistEntryId)).toEqual(["0", "1", "2"]);
  });
  it("retains entry order, deduplicates lookups and leaves remote or deleted references unresolved", async () => {
    const load = vi.fn(async (id: string) => {
      if (id === "removed") throw new ApiError("NOT_FOUND", "Missing track", 404);
      return { ...track, sourceTrackId: id };
    });
    const items = [entry("hidden-asmr"), entry(null), entry("hidden-asmr", "duplicate"), entry("removed")];
    const result = await resolvePlaylistTracks(items, load, new AbortController().signal);
    expect(load.mock.calls.map(([id]) => id)).toEqual(["hidden-asmr", "removed"]);
    expect(result.map((item) => [item.entryId, item.track?.sourceTrackId ?? null])).toEqual([
      ["hidden-asmr", "hidden-asmr"], ["remote", null], ["duplicate", "hidden-asmr"], ["removed", null],
    ]);
  });
  it("limits parallel reads and propagates transient failures instead of marking them unavailable", async () => {
    let active = 0, maximum = 0;
    const load = async (id: string) => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      --active;
      return { ...track, sourceTrackId: id };
    };
    await resolvePlaylistTracks(Array.from({ length: 12 }, (_, index) => entry(String(index))), load, new AbortController().signal);
    expect(maximum).toBe(4);
    const failure = new ApiError("NETWORK_ERROR", "Connection failed");
    await expect(resolvePlaylistTracks([entry("hidden-cd")], async () => { throw failure; }, new AbortController().signal)).rejects.toBe(failure);
    const controller = new AbortController(); controller.abort();
    const cancelled = vi.fn(load);
    await expect(resolvePlaylistTracks([entry("hidden-cd")], cancelled, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).not.toHaveBeenCalled();
  });
  it("encodes direct source identities and rejects a response for a different track", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...track, sourceTrackId: "folder/音轨" })))
      .mockResolvedValueOnce(new Response(JSON.stringify(track)));
    const api = new LibraryApi(new ApiClient(fetcher));
    expect((await api.track("folder/音轨")).sourceTrackId).toBe("folder/音轨");
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/source-tracks/folder%2F%E9%9F%B3%E8%BD%A8");
    await expect(api.track("another")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
