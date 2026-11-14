import { afterEach, describe, expect, it, vi } from "vitest";
import { Services } from "../../../src/app/services";
import { deferred, page, track } from "../../fixtures/dto";
import type { MusicTrackPage } from "../../../src/api/music-catalog";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("work package library invalidation", () => {
  it("clears every cached scope and discards pending reads without touching the playback queue", async () => {
    vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => "probably" }) });
    const services = new Services({} as HTMLElement);
    const old = deferred<MusicTrackPage>();
    const load = vi.spyOn(services.musicCatalog, "tracks").mockResolvedValue(page("old", "cursor"));
    const all = services.library("all"), local = services.library("local");
    await all.select("all"); await local.select("local");
    load.mockReturnValueOnce(old.promise);
    const pending = all.more();
    services.enqueue([track]);
    const queue = services.queue.value;
    const stop = vi.spyOn(services.player, "stop");
    services.invalidateLibraries();
    expect(all.snapshot.items).toEqual([]); expect(local.snapshot.items).toEqual([]);
    expect(all.snapshot.cursor).toBeNull();
    old.resolve(page("late-old")); await pending;
    expect(all.snapshot.items).toEqual([]);
    expect(services.queue.value).toBe(queue); expect(stop).not.toHaveBeenCalled();
    load.mockResolvedValueOnce(page("ordinary", null, "2"));
    await all.select("all");
    expect(all.snapshot.items.map((item) => item.trackId)).toEqual(["ordinary"]);
  });
  it("refreshes an already visible library when import finishes after navigation", async () => {
    vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => "probably" }) });
    const services = new Services({} as HTMLElement);
    const fresh = deferred<MusicTrackPage>();
    const load = vi.spyOn(services.musicCatalog, "tracks").mockResolvedValueOnce(page("old")).mockReturnValueOnce(fresh.promise);
    const library = services.library("all"); await library.select("all");
    library.onChange = vi.fn();
    services.invalidateLibraries();
    expect(library.snapshot.items).toEqual([]); expect(library.snapshot.loading).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    fresh.resolve(page("ordinary", null, "2"));
    await vi.waitFor(() => expect(library.snapshot.items[0]?.trackId).toBe("ordinary"));
  });
});
