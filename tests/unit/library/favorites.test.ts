import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../src/api/client";
import type { FavoriteEntry, FavoritePage } from "../../../src/api/favorites";
import { FavoritesState } from "../../../src/library/favorites";
import { deferred, track } from "../../fixtures/dto";
import { musicTrack } from "../../fixtures/music-catalog";

const entry = (id: string, title = id): FavoriteEntry => {
  const source = { ...track, sourceTrackId: id, title };
  return { track: source, musicTrack: musicTrack(source), forcedSourceTrackId: null, recordedAt: "2026-10-22T10:00:00Z" };
};
const page = (ids: string[], nextCursor: string | null = null, revision = "1"): FavoritePage => ({ items: ids.map((id) => entry(id)), nextCursor, revision });
function fixture() {
  const api = { page: vi.fn().mockResolvedValue(page([])), add: vi.fn().mockImplementation(async (id: string) => entry(id)), remove: vi.fn().mockResolvedValue(undefined), batch: vi.fn().mockResolvedValue({ affected: 0, sourceTrackIds: [] }) };
  const state = new FavoritesState(api); state.setSession("server", "user");
  return { api, state };
}
describe("Personal favorites state", () => {
  it("keeps batch writes in the session and serializes a later individual toggle", async () => {
    const { api, state } = fixture();
    const pending = deferred<{ affected: number; sourceTrackIds: string[] }>();
    api.batch.mockReturnValueOnce(pending.promise);
    const batch = state.setBatch({ batch: true, libraryRevision: "1" }, true, []);
    const remove = state.setFavorite(entry("bulk").musicTrack, false);
    await vi.waitFor(() => expect(api.batch).toHaveBeenCalledOnce());
    expect(api.remove).not.toHaveBeenCalled();
    pending.resolve({ affected: 1, sourceTrackIds: ["bulk"] });
    await batch; await remove;
    expect(state.has("bulk")).toBe(false);
    expect(state.value.pending).toEqual([]);
  });
  it("discards an old session's late bulk response", async () => {
    const { api, state } = fixture();
    const pending = deferred<{ affected: number; sourceTrackIds: string[] }>();
    api.batch.mockReturnValueOnce(pending.promise);
    const batch = state.setBatch({ batch: true, libraryRevision: "1" }, true, []);
    await vi.waitFor(() => expect(api.batch).toHaveBeenCalledOnce());
    const signal = api.batch.mock.calls[0][2] as AbortSignal;
    state.setSession("server", "other");
    expect(signal.aborted).toBe(true);
    pending.resolve({ affected: 1, sourceTrackIds: ["bulk"] }); await batch;
    expect(state.has("bulk")).toBe(false);
    expect(state.value.pending).toEqual([]);
  });
  it("applies bulk IDs without fetching metadata and refreshes lazily on the next view", async () => {
    const { api, state } = fixture();
    await state.load();
    state.applyBatch(["loaded", "unloaded"], true, [entry("loaded").musicTrack]);
    expect(api.page).toHaveBeenCalledTimes(1);
    expect(state.has("loaded")).toBe(true);
    expect(state.has("unloaded")).toBe(true);
    expect(state.value.items.map((track) => track.trackId)).toEqual(["loaded"]);
    await state.setFavorite(entry("unloaded").musicTrack, false);
    expect(state.has("unloaded")).toBe(false);
    api.page.mockResolvedValueOnce(page(["loaded"]));
    await state.load();
    expect(api.page).toHaveBeenCalledTimes(2);
    state.setSession("server", "another-user");
    expect(state.has("loaded")).toBe(false);
  });
  it("does not overwrite confirmed bulk IDs with a previously started collection read", async () => {
    const { api, state } = fixture();
    const pending = deferred<FavoritePage>();
    api.page.mockReturnValueOnce(pending.promise);
    const loading = state.load();
    state.applyBatch(["added"], true, []);
    state.applyBatch(["removed"], false, []);
    pending.resolve(page(["removed"])); await loading;
    expect(state.has("added")).toBe(true);
    expect(state.has("removed")).toBe(false);
    api.page.mockResolvedValueOnce(page(["added"]));
    await state.load();
    expect(state.value.items.map((track) => track.trackId)).toEqual(["added"]);
  });
  it("keeps source aliases consistent after bulk removal and a sibling source toggle", async () => {
    const { api, state } = fixture();
    const first = { ...track, sourceTrackId: "source-a" };
    const second = { ...track, sourceTrackId: "source-b" };
    const music = { ...musicTrack(first), trackId: "canonical", selectedSource: { ...first, versions: [first, second] } };
    const saved = { musicTrack: music, track: first, forcedSourceTrackId: null, recordedAt: "2026-10-22T10:00:00Z" };
    api.page.mockResolvedValueOnce({ items: [saved], nextCursor: null, revision: "1" });
    await state.load();
    state.applyBatch(["source-a"], false, [first]);
    api.add.mockResolvedValueOnce(saved);
    await state.setFavorite(second, true);
    for (const id of ["source-a", "source-b", "canonical"]) expect(state.has(id)).toBe(true);
    state.applyBatch(["source-a", "source-b"], true, [music]);
    await state.setFavorite(second, false);
    for (const id of ["source-a", "source-b", "canonical"]) expect(state.has(id)).toBe(false);
  });
  it("drops obsolete canonical source aliases after a complete refreshed snapshot", async () => {
    const { api, state } = fixture();
    const source = { ...track, sourceTrackId: "moved-source" };
    const music = { ...musicTrack(source), trackId: "old-track" };
    api.page.mockResolvedValueOnce({ items: [{ musicTrack: music, track: source, forcedSourceTrackId: null, recordedAt: "2026-10-22T10:00:00Z" }], nextCursor: null, revision: "1" });
    await state.load();
    api.page.mockResolvedValueOnce(page([]));
    await state.load(true);
    await state.setFavorite(source, true);
    expect(api.add.mock.calls[0][0]).toBe("moved-source");
  });
  it("loads every page atomically, deduplicates requests and preserves distinct tracks", async () => {
    const { api, state } = fixture();
    const more = deferred<FavoritePage>();
    api.page.mockResolvedValueOnce(page(["a"], "cursor")).mockReturnValueOnce(more.promise);
    const first = state.load(); const second = state.load();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(api.page).toHaveBeenCalledTimes(2));
    expect(state.value.items).toEqual([]);
    more.resolve(page(["b"])); await first;
    expect(state.value.items.map((item) => item.trackId)).toEqual(["a", "b"]);
    expect(state.value).toMatchObject({ loaded: true, loading: false, error: null });
    await state.load(); expect(api.page).toHaveBeenCalledTimes(2);
  });
  it("restarts expired pagination without mixing revisions", async () => {
    const { api, state } = fixture();
    api.page.mockResolvedValueOnce(page(["old"], "cursor")).mockRejectedValueOnce(new ApiError("CURSOR_EXPIRED", "expired", 410))
      .mockResolvedValueOnce(page(["fresh"], null, "2"));
    await state.load();
    expect(state.value.items.map((item) => item.trackId)).toEqual(["fresh"]);
    expect(api.page.mock.calls.map((call) => call[0])).toEqual([null, "cursor", null]);
  });
  it("detects pagination cycles and retains the previous complete collection on failure", async () => {
    const { api, state } = fixture();
    api.page.mockResolvedValueOnce(page(["saved"])); await state.load();
    api.page.mockResolvedValueOnce(page(["new"], "cursor")).mockResolvedValueOnce(page(["more"], "cursor"));
    await state.load(true);
    expect(state.value.items.map((item) => item.trackId)).toEqual(["saved"]);
    expect(state.value.error).toContain("未能继续加载");
  });
  it("uses server-confirmed metadata and keeps the previous state if a write fails", async () => {
    const { api, state } = fixture();
    const pending = deferred<FavoriteEntry>(); api.add.mockReturnValueOnce(pending.promise);
    const write = state.setFavorite(track, true);
    expect(state.has(track.sourceTrackId)).toBe(false); expect(state.value.pending).toEqual([track.sourceTrackId]);
    pending.resolve(entry(track.sourceTrackId, "Server title")); await write;
    expect(state.value.items[0].title).toBe("Server title"); expect(state.value.pending).toEqual([]);
    api.remove.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "offline"));
    await expect(state.setFavorite(track, false)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(state.has(track.sourceTrackId)).toBe(true);
    await state.setFavorite(track, false); expect(state.has(track.sourceTrackId)).toBe(false);
  });
  it("does not let a late list overwrite confirmed add and remove operations", async () => {
    const { api, state } = fixture();
    const read = deferred<FavoritePage>(); api.page.mockReturnValueOnce(read.promise);
    const loading = state.load();
    await state.setFavorite({ ...track, sourceTrackId: "added" }, true);
    await state.setFavorite({ ...track, sourceTrackId: "removed" }, false);
    read.resolve(page(["removed", "unchanged"])); await loading;
    expect(state.value.items.map((item) => item.trackId)).toEqual(["added", "unchanged"]);
  });
  it("serializes toggles of one source track", async () => {
    const { api, state } = fixture();
    const pending = deferred<FavoriteEntry>(); api.add.mockReturnValueOnce(pending.promise);
    const add = state.setFavorite(track, true); const remove = state.setFavorite(track, false);
    await vi.waitFor(() => expect(api.add).toHaveBeenCalledOnce());
    expect(api.remove).not.toHaveBeenCalled();
    pending.resolve(entry(track.sourceTrackId)); await add; await remove;
    expect(state.has(track.sourceTrackId)).toBe(false); expect(state.value.pending).toEqual([]);
  });
  it("ignores reads and writes from the previous session and cancels queued toggles", async () => {
    const { api, state } = fixture();
    const read = deferred<FavoritePage>(); const write = deferred<FavoriteEntry>();
    api.page.mockReturnValueOnce(read.promise); api.add.mockReturnValueOnce(write.promise);
    const loading = state.load(); const adding = state.setFavorite(track, true); const removing = state.setFavorite(track, false);
    await vi.waitFor(() => expect(api.add).toHaveBeenCalledOnce());
    const readSignal = api.page.mock.calls[0][1] as AbortSignal;
    state.setSession("server", "another-user");
    expect(readSignal.aborted).toBe(true);
    await state.load();
    read.resolve(page(["previous-user"])); write.resolve(entry(track.sourceTrackId));
    await Promise.all([loading, adding, removing]);
    expect(state.value.items).toEqual([]); expect(state.value.loaded).toBe(true);
    expect(api.remove).not.toHaveBeenCalled();
    state.clear(); await expect(state.setFavorite(track, true)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
