import { describe, expect, it } from "vitest";
import { PlaybackQueue, type PlaybackMode } from "../../../src/player/playback-queue";
import { track } from "../../fixtures/dto";

const first = { ...track, sourceTrackId: "first" };
const second = { ...track, sourceTrackId: "second" };
const third = { ...track, sourceTrackId: "third" };

describe("playback queue navigation", () => {
  it.each<PlaybackMode>(["sequence", "repeat-one", "repeat-all", "shuffle"])("does not navigate an empty %s queue", (mode) => {
    const queue = new PlaybackQueue();
    queue.setMode(mode);
    expect(queue.canAdvance(1)).toBe(false);
    expect(queue.canAdvance(-1)).toBe(false);
    expect(queue.advance(1, true)).toBeNull();
    queue.shuffle();
    expect(queue.value).toEqual({ items: [], index: -1, mode });
  });

  it("starts an unselected queue at its first entry and respects sequential boundaries", () => {
    const queue = new PlaybackQueue();
    queue.enqueue([first, second]);
    expect(queue.canAdvance(-1)).toBe(false);
    expect(queue.advance(1)).toBe(first);
    expect(queue.advance(-1)).toBeNull();
    expect(queue.advance(1)).toBe(second);
    expect(queue.advance(1, true)).toBeNull();
  });

  it("wraps both directions in repeat-all and only natural endings in repeat-one", () => {
    const queue = new PlaybackQueue();
    queue.replace(first, [first, second, third]);
    queue.setMode("repeat-all");
    expect(queue.advance(-1)).toBe(third);
    expect(queue.advance(1, true)).toBe(first);
    queue.setMode("repeat-one");
    expect(queue.advance(1, true)).toBe(first);
    expect(queue.advance(1)).toBe(second);
    expect(queue.advance(-1)).toBe(first);
    expect(queue.advance(-1)).toBeNull();
  });

  it("avoids the current song in shuffle and retraces history in both directions", () => {
    const queue = new PlaybackQueue(() => 0);
    queue.replace(first, [first, second, third]);
    queue.setMode("shuffle");
    queue.commitSelection();
    expect(queue.canAdvance(-1)).toBe(false);
    expect(queue.advance(1)).toBe(second);
    queue.commitSelection();
    expect(queue.advance(1, true)).toBe(first);
    queue.commitSelection();
    expect(queue.advance(-1)).toBe(second);
    queue.commitSelection();
    expect(queue.advance(-1)).toBe(first);
    queue.commitSelection();
    expect(queue.canAdvance(-1)).toBe(false);
    expect(queue.advance(1)).toBe(second);
    queue.commitSelection();
    expect(queue.advance(1)).toBe(first);
  });

  it("prefers another song over another occurrence of the current song", () => {
    const queue = new PlaybackQueue(() => 0);
    queue.replace(first, [first, first, second]);
    queue.setMode("shuffle");
    expect(queue.advance(1)).toBe(second);
    queue.replace(first, [first, first]);
    expect(queue.advance(1)).toBe(first);
    expect(queue.value.index).toBe(1);
  });

  it("repeats a single entry naturally in shuffle without offering a manual skip", () => {
    const queue = new PlaybackQueue();
    queue.replace(first);
    queue.setMode("shuffle");
    expect(queue.canAdvance(1)).toBe(false);
    expect(queue.canAdvance(-1)).toBe(false);
    expect(queue.advance(1, true)).toBe(first);
  });

  it("retains a recorded previous entry when a pending backward selection is reversed", () => {
    const queue = new PlaybackQueue();
    queue.replace(first, [first, second, third]);
    queue.setMode("shuffle");
    queue.commitSelection();
    queue.select(1); queue.commitSelection();
    queue.select(2); queue.commitSelection();
    expect(queue.advance(-1)).toBe(second);
    expect(queue.advance(1)).toBe(third);
    queue.commitSelection();
    expect(queue.advance(-1)).toBe(second);
  });

  it("retains recorded forward entries when consecutive backward selections skip a fade", () => {
    const queue = new PlaybackQueue();
    queue.replace(first, [first, second, third]);
    queue.setMode("shuffle");
    queue.commitSelection();
    queue.select(1); queue.commitSelection();
    queue.select(2); queue.commitSelection();
    expect(queue.advance(-1)).toBe(second);
    expect(queue.advance(-1)).toBe(first);
    queue.commitSelection();
    expect(queue.advance(1)).toBe(second);
    queue.commitSelection();
    expect(queue.advance(1)).toBe(third);
  });
});

describe("queue reordering and selection snapshots", () => {
  it("relocates the active occurrence even when identical object references repeat", () => {
    const queue = new PlaybackQueue(() => 0);
    queue.replace(first, [first, second, first]);
    queue.select(2);
    queue.shuffle();
    expect(queue.value.items).toEqual([second, first, first]);
    expect(queue.value.index).toBe(1);
  });

  it("remaps random navigation history and future when shuffling the list", () => {
    const queue = new PlaybackQueue(() => 0);
    queue.replace(first, [first, second, third]);
    queue.setMode("shuffle");
    queue.commitSelection();
    queue.advance(1);
    queue.commitSelection();
    queue.advance(1);
    queue.commitSelection();
    queue.advance(-1);
    queue.commitSelection();
    queue.shuffle();
    expect(queue.value.items).toEqual([second, third, first]);
    expect(queue.value.index).toBe(0);
    expect(queue.advance(-1)).toBe(first);
    queue.commitSelection();
    expect(queue.value.index).toBe(2);
    expect(queue.advance(1)).toBe(second);
    queue.commitSelection();
    expect(queue.advance(1)).toBe(first);
  });

  it("preserves additions and shuffled order when a pending selection rolls back", () => {
    const queue = new PlaybackQueue(() => 0);
    queue.replace(first, [first, second]);
    queue.commitSelection();
    queue.advance(1);
    queue.enqueue([third]);
    queue.shuffle();
    queue.rollbackSelection();
    expect(queue.value.items).toEqual([second, third, first]);
    expect(queue.value.index).toBe(2);
  });

  it("keeps the old list snapshot independent when a replacement list is shuffled", () => {
    const queue = new PlaybackQueue(() => 0);
    queue.replace(first, [first, second]);
    queue.commitSelection();
    queue.replace(third, [third, first]);
    queue.shuffle();
    queue.setMode("repeat-all");
    queue.rollbackSelection();
    expect(queue.value).toEqual({ items: [first, second], index: 0, mode: "repeat-all" });
  });
});
