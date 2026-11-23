import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "../../src/app/services";
import { PlayerController } from "../../src/player/controller";
import type { AudioPort, MediaObservation } from "../../src/player/audio-adapter";
import { deferred, playback, track } from "../fixtures/dto";

const first = { ...track, sourceTrackId: "first" };
const second = { ...track, sourceTrackId: "second" };
const third = { ...track, sourceTrackId: "third" };
const other = { ...track, sourceTrackId: "other" };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => "probably" }) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  const services = new Services({} as HTMLElement);
  const fades: ReturnType<typeof deferred<void>>[] = [];
  let observe: (event: MediaObservation) => void = () => {};
  const audio: AudioPort = {
    play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), destroy: vi.fn(), seek: vi.fn(),
    seconds: 0, seekable: [{ start: 0, end: 30 }],
    fadeOut: () => {
      const fade = deferred<void>(); fades.push(fade); return fade.promise;
    },
    cancelFade: () => { for (const fade of fades) fade.resolve(); },
  };
  const api = {
    create: vi.fn().mockResolvedValue(playback()), close: vi.fn().mockResolvedValue(undefined),
    control: vi.fn().mockResolvedValue(playback("seeked")),
  };
  const player = new PlayerController(api, (_url, listener) => { observe = listener; return audio; }, { htmlAudio: true, formats: [] });
  player.onChange = services.player.onChange;
  player.onSelectionCancelled = services.player.onSelectionCancelled;
  services.player = player;
  player.setTransitions({ enabled: true, trackMs: 300, seekMs: 0, pauseMs: 0 });
  return {
    services, player, api, fades,
    playing: () => observe({ type: "playing", seconds: 0, paused: false }),
    progress: () => observe({ type: "timeupdate", seconds: 12, paused: false }),
    ended: () => observe({ type: "ended", seconds: 30, paused: true }),
  };
}

describe("queue rollback when seeking during a track transition", () => {
  it("restores the actual playing queue after repeated next requests", async () => {
    const s = setup();
    s.services.play(first, [first, second, third]); await settle(); s.playing();
    s.services.next(1); s.services.next(1);
    expect(s.services.queue.value.index).toBe(2);
    s.player.seek(10_000); await settle();
    expect(s.services.queue.value).toEqual({ items: [first, second, third], index: 0, mode: "sequence" });
    expect(s.player.state.track?.sourceTrackId).toBe("first");
    expect(s.api.create).toHaveBeenCalledOnce();
    s.player.stop();
  });

  it("restores the prior list even when selecting the same track from another list", async () => {
    const s = setup();
    s.services.play(first, [first, second]); await settle(); s.playing();
    s.services.play(first, [other, first, third]);
    s.services.setPlaybackMode("repeat-all");
    s.player.seek(10_000); await settle();
    expect(s.services.queue.value).toEqual({ items: [first, second], index: 0, mode: "repeat-all" });
    expect(s.api.create).toHaveBeenCalledOnce();
    s.player.stop();
  });

  it("keeps additions to the active queue and restores it after replacing the whole list", async () => {
    const s = setup();
    s.services.play(first, [first, second]); await settle(); s.playing();
    s.services.enqueue([third]);
    s.services.play(other, [other]);
    s.player.seek(10_000); await settle();
    expect(s.services.queue.value.items).toEqual([first, second, third]);
    expect(s.services.queue.value.index).toBe(0);
    s.player.stop();
  });

  it("captures each committed selection across the transient empty state", async () => {
    const s = setup();
    s.services.play(first, [first, second]); await settle(); s.playing();
    s.services.next(1); s.fades[0].resolve(); await settle(); s.playing();
    expect(s.player.state.track?.sourceTrackId).toBe("second");
    s.services.play(other, [other, third]);
    s.player.seek(10_000); await settle();
    expect(s.services.queue.value).toEqual({ items: [first, second], index: 1, mode: "sequence" });
    expect(s.player.state.track?.sourceTrackId).toBe("second");
    expect(s.api.create).toHaveBeenCalledTimes(2);
    s.player.stop();
  });

  it("keeps shuffled order and restores the actual duplicate entry when a fade is cancelled", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const s = setup();
    const duplicate = { ...first, title: "Another queue entry" };
    s.services.play(duplicate, [first, second, duplicate]); await settle(); s.playing();
    s.services.setPlaybackMode("repeat-all");
    s.services.next(1);
    s.services.shuffleQueue();
    expect(s.services.queue.value.index).toBe(2);
    s.player.seek(10_000); await settle();
    expect(s.services.queue.value.items).toEqual([second, duplicate, first]);
    expect(s.services.queue.value.index).toBe(1);
    expect(s.services.queue.value.items[1]).toBe(duplicate);
    expect(s.player.state.track).toBe(duplicate);
    expect(s.api.create).toHaveBeenCalledOnce();
    s.player.stop();
  });

  it("rolls back random navigation history together with a cancelled selection", async () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValue(0.99);
    const s = setup();
    s.services.setPlaybackMode("shuffle");
    s.services.play(first, [first, second, third]); await settle(); s.playing();
    s.services.next(1);
    s.services.next(1);
    expect(s.services.canNext(-1)).toBe(true);
    s.player.seek(10_000); await settle();
    expect(s.services.queue.value.index).toBe(0);
    expect(s.services.canNext(-1)).toBe(false);
    s.player.stop();
  });

  it("records only committed tracks after repeated random next requests during a fade", async () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValue(0.99);
    const s = setup();
    s.services.setPlaybackMode("shuffle");
    s.services.play(first, [first, second, third]); await settle(); s.playing();
    s.services.next(1); s.services.next(1);
    expect(s.services.queue.value.index).toBe(2);
    for (const fade of s.fades) fade.resolve();
    await settle(); s.playing();
    expect(s.player.state.track).toBe(third);
    s.services.next(-1);
    s.fades.at(-1)!.resolve(); await settle();
    expect(s.player.state.track).toBe(first);
    expect(s.services.canNext(-1)).toBe(false);
    expect(s.api.create.mock.calls.map((call) => call[0])).toEqual(["first", "third", "first"]);
    s.player.stop();
  });
});

describe("playback modes and queue order", () => {
  it("replays a finished track in repeat-one while manual next still selects its neighbour", async () => {
    const s = setup();
    s.player.setTransitions({ enabled: false, trackMs: 0, seekMs: 0, pauseMs: 0 });
    s.services.setPlaybackMode("repeat-one");
    s.services.play(first, [first, second]); await settle(); s.playing();
    s.ended(); await settle();
    expect(s.api.create).toHaveBeenCalledTimes(2);
    expect(s.player.state.track).toBe(first);
    expect(s.services.queue.value.index).toBe(0);
    s.services.next(1); await settle();
    expect(s.player.state.track).toBe(second);
    expect(s.services.canNext(1)).toBe(false);
    s.player.stop();
  });

  it("stops advancing at the end of sequence and wraps naturally in repeat-all", async () => {
    const s = setup();
    s.services.play(second, [first, second]); await settle(); s.playing();
    s.ended(); await settle();
    expect(s.player.state.phase).toBe("ended");
    expect(s.api.create).toHaveBeenCalledOnce();
    s.services.setPlaybackMode("repeat-all");
    s.services.play(second, [first, second]); await settle(); s.playing();
    s.ended(); await settle();
    expect(s.player.state.track).toBe(first);
    expect(s.services.queue.value.index).toBe(0);
    s.player.stop();
  });

  it("shuffles queue entries without restarting playback or changing the progress", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const s = setup();
    s.services.play(first, [first, second, third]); await settle(); s.playing(); s.progress();
    const currentPlayback = s.player.state.playback;
    const currentPosition = s.player.state.positionMs;
    s.services.shuffleQueue();
    expect(s.services.queue.value.items).toEqual([second, third, first]);
    expect(s.services.queue.value.index).toBe(2);
    expect(s.player.state.playback).toBe(currentPlayback);
    expect(s.player.state.positionMs).toBe(currentPosition);
    expect(s.player.state.phase).toBe("playing");
    expect(s.api.create).toHaveBeenCalledOnce();
    expect(s.api.close).not.toHaveBeenCalled();
    expect(s.fades).toHaveLength(0);
    s.player.stop();
  });

  it("selects the requested duplicate queue entry and wraps from that exact index", async () => {
    const s = setup();
    s.services.play(first, [first, second, first]); await settle();
    s.services.playQueueIndex(2); await settle();
    expect(s.services.queue.value.index).toBe(2);
    s.services.setPlaybackMode("repeat-all");
    s.services.next(1); await settle();
    expect(s.services.queue.value.index).toBe(0);
    s.player.stop();
  });
});

describe("track queue actions", () => {
  it("appends and plays a requested track while preserving the existing queue", async () => {
    const s = setup();
    s.player.setTransitions({ enabled: false, trackMs: 0, seekMs: 0, pauseMs: 0 });
    s.services.play(first, [first, second]); await settle(); s.playing();
    s.services.play(first); await settle();
    expect(s.services.queue.value.items).toEqual([first, second, first]);
    expect(s.services.queue.value.index).toBe(2);
    expect(s.player.state.track).toBe(first);
    expect(s.api.create).toHaveBeenCalledTimes(2);
    s.services.play({ ...third, availability: "unavailable" });
    expect(s.services.queue.value.items).toEqual([first, second, first]);
    expect(s.api.create).toHaveBeenCalledTimes(2);
    s.player.stop();
  });

  it("keeps the appended track but restores the playing entry when its fade is cancelled", async () => {
    const s = setup();
    s.services.setPlaybackMode("shuffle");
    s.services.play(first, [first, second]); await settle(); s.playing();
    s.services.play(third);
    expect(s.services.queue.value.index).toBe(2);
    s.player.seek(10_000); await settle();
    expect(s.services.queue.value.items).toEqual([first, second, third]);
    expect(s.services.queue.value.index).toBe(0);
    expect(s.services.canNext(-1)).toBe(false);
    expect(s.player.state.track).toBe(first);
    expect(s.api.create).toHaveBeenCalledOnce();
    s.player.stop();
  });

  it("adds next tracks without interrupting playback and prioritizes them in shuffle mode", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const s = setup();
    s.player.setTransitions({ enabled: false, trackMs: 0, seekMs: 0, pauseMs: 0 });
    s.services.setPlaybackMode("shuffle");
    s.services.play(first, [first, second]); await settle(); s.playing(); s.progress();
    s.services.playNext([third, other]);
    expect(s.services.queue.value.items).toEqual([first, third, other, second]);
    expect(s.services.queue.value.index).toBe(0);
    expect(s.player.state.track).toBe(first);
    expect(s.player.state.positionMs).toBe(12_000);
    expect(s.api.create).toHaveBeenCalledOnce();
    expect(s.fades).toHaveLength(0);
    s.services.next(1); await settle();
    expect(s.player.state.track).toBe(third);
    s.services.next(1); await settle();
    expect(s.player.state.track).toBe(other);
    s.player.stop();
  });

  it("can stage the first next track without starting an empty player", async () => {
    const s = setup();
    s.services.playNext([first]);
    expect(s.services.queue.value.index).toBe(-1);
    expect(s.api.create).not.toHaveBeenCalled();
    s.services.next(1); await settle();
    expect(s.player.state.track).toBe(first);
    s.player.stop();
  });
});
