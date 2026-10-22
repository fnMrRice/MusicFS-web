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
afterEach(() => vi.unstubAllGlobals());

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
  player.setTransitions(true, 300);
  return { services, player, api, fades, playing: () => observe({ type: "playing", seconds: 0, paused: false }) };
}

describe("queue rollback when seeking during a track transition", () => {
  it("restores the actual playing queue after repeated next requests", async () => {
    const s = setup();
    s.services.play(first, [first, second, third]); await settle(); s.playing();
    s.services.next(1); s.services.next(1);
    expect(s.services.queue.value.index).toBe(2);
    s.player.seek(10_000); await settle();
    expect(s.services.queue.value).toEqual({ items: [first, second, third], index: 0, repeat: false });
    expect(s.player.state.track?.sourceTrackId).toBe("first");
    expect(s.api.create).toHaveBeenCalledOnce();
    s.player.stop();
  });

  it("restores the prior list even when selecting the same track from another list", async () => {
    const s = setup();
    s.services.play(first, [first, second]); await settle(); s.playing();
    s.services.play(first, [other, first, third]);
    s.services.queue.set({ ...s.services.queue.value, repeat: true });
    s.player.seek(10_000); await settle();
    expect(s.services.queue.value).toEqual({ items: [first, second], index: 0, repeat: true });
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
    expect(s.services.queue.value).toEqual({ items: [first, second], index: 1, repeat: false });
    expect(s.player.state.track?.sourceTrackId).toBe("second");
    expect(s.api.create).toHaveBeenCalledTimes(2);
    s.player.stop();
  });
});
