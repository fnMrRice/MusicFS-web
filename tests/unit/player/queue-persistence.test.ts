import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackQueue } from "../../../src/player/playback-queue";
import { QueuePersistence } from "../../../src/player/queue-persistence";
import { track } from "../../fixtures/dto";

const key = "musicfs:playback-queue:v1";
const server = "https://musicfs.test/api/v1";
const saved = new Map<string, string>();
const first = { ...track, sourceTrackId: "first" };
const second = { ...track, sourceTrackId: "second" };
const third = { ...track, sourceTrackId: "third" };
const fourth = { ...track, sourceTrackId: "fourth" };
const empty = { items: [], index: -1, mode: "sequence" };

beforeEach(() => {
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => saved.get(name) ?? null,
    setItem: (name: string, value: string) => { saved.set(name, value); },
    removeItem: (name: string) => { saved.delete(name); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

function connected() {
  const queue = new PlaybackQueue(() => 0);
  const persistence = new QueuePersistence(queue);
  persistence.setServer(server);
  return { queue, persistence };
}
function cache(queue: unknown) {
  saved.set(key, JSON.stringify({ serverAddress: server, queue }));
}

describe("queue persistence", () => {
  it("restores duplicate entries, their selected occurrence and mode from the single cache", () => {
    const { queue } = connected();
    queue.enqueue([first, second, first]);
    queue.select(2);
    queue.setMode("repeat-one");
    expect([...saved.keys()]).toEqual([key]);
    expect(JSON.parse(saved.get(key)!)).toMatchObject({ serverAddress: server });

    const restored = connected().queue;
    expect(restored.value).toMatchObject({ items: [first, second, first], index: 2, mode: "repeat-one" });
    expect(restored.value.items[0]).not.toBe(restored.value.items[2]);
  });

  it("clears the shared cache on server changes and cannot restore an earlier server", () => {
    const { queue, persistence } = connected();
    queue.enqueue([first]);
    persistence.setServer("https://other.test/api/v1");
    expect(queue.value).toEqual(empty);
    expect(saved.has(key)).toBe(false);
    queue.enqueue([second]);
    persistence.setServer(server);
    expect(queue.value).toEqual(empty);
    expect(saved.has(key)).toBe(false);
    persistence.setServer("https://other.test/api/v1");
    expect(queue.value).toEqual(empty);
  });

  it("detaches without deleting saved entries and clears both memory and cache on logout", () => {
    const { queue, persistence } = connected();
    queue.enqueue([first]);
    const previous = saved.get(key);
    persistence.detach();
    queue.enqueue([second]);
    expect(queue.value.items).toEqual([first, second]);
    expect(saved.get(key)).toBe(previous);
    persistence.clear();
    expect(queue.value).toEqual(empty);
    expect(saved.has(key)).toBe(false);
    queue.enqueue([third]);
    expect(saved.has(key)).toBe(false);
  });

  it.each([
    "{broken",
    "null",
    JSON.stringify({ serverAddress: server, queue: { items: "invalid", mode: "sequence" } }),
    JSON.stringify({ serverAddress: server, queue: { items: [first], mode: "invalid" } }),
    JSON.stringify({ serverAddress: server, queue: { items: [null], mode: "sequence" } }),
    JSON.stringify({ serverAddress: server, queue: { items: [{ ...first, sourceTrackId: "" }], mode: "sequence" } }),
    JSON.stringify({ serverAddress: server, queue: { items: [{ ...first, availability: "unavailable" }], mode: "sequence" } }),
  ])("ignores corrupt or invalid cached data: %s", (value) => {
    saved.set(key, value);
    const { queue } = connected();
    expect(queue.value).toEqual(empty);
    expect(() => queue.enqueue([second])).not.toThrow();
    expect(connected().queue.value.items).toMatchObject([second]);
  });

  it.each([-2, 2, 0.5, "1", null])("sanitizes invalid selection %s and navigation indices", (index) => {
    cache({ items: [first, second], index, mode: "shuffle",
      history: [0, -1, 0.5, "1", 1, 99], future: [null, 0], priority: [1, 2, "0"] });
    const { queue } = connected();
    expect(queue.snapshot()).toMatchObject({ index: -1, history: [0, 1], future: [0], priority: [1] });
  });

  it("keeps queue operations usable when local storage is blocked", () => {
    const blocked = () => { throw new Error("Storage unavailable"); };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
    const { queue, persistence } = connected();
    expect(() => {
      queue.enqueue([first, second]);
      queue.select(1);
      queue.setMode("repeat-all");
    }).not.toThrow();
    expect(queue.value).toMatchObject({ items: [first, second], index: 1, mode: "repeat-all" });
    expect(() => persistence.clear()).not.toThrow();
    expect(queue.value).toEqual(empty);
  });

  it("stores and restores only approved track metadata without version trees or unknown fields", () => {
    const { queue } = connected();
    const decorated = { ...first, versions: [second], playback: { sessionId: "old-session" }, unknown: "ignored" };
    queue.enqueue([decorated]);
    const stored = JSON.parse(saved.get(key)!).queue.items[0];
    expect(stored).toMatchObject(first);
    for (const field of ["versions", "playback", "unknown"]) expect(stored).not.toHaveProperty(field);

    // 即使缓存被外部改写，恢复时也再次验证字段与元数据类型。
    cache({ items: [{ ...decorated, title: false, artists: ["Artist", 42], durationMs: -1 }], index: 0, mode: "sequence" });
    const restored = connected().queue.value.items[0];
    expect(restored).toMatchObject({ sourceTrackId: "first", title: null, artists: ["Artist"], durationMs: null });
    for (const field of ["versions", "playback", "unknown"]) expect(restored).not.toHaveProperty(field);
  });

  it("restores shuffle history and forward navigation across refresh", () => {
    const { queue } = connected();
    queue.replace(first, [first, second, third]);
    queue.setMode("shuffle");
    queue.commitSelection();
    queue.select(1); queue.commitSelection();
    queue.select(2); queue.commitSelection();
    queue.advance(-1); queue.commitSelection();

    const restored = connected().queue;
    expect(restored.snapshot()).toMatchObject({ index: 1, history: [0], future: [2] });
    expect(restored.advance(-1)?.sourceTrackId).toBe("first");
    restored.commitSelection();
    expect(restored.advance(1)?.sourceTrackId).toBe("second");
    restored.commitSelection();
    expect(restored.advance(1)?.sourceTrackId).toBe("third");
  });

  it("preserves play-next priority after shuffling and refreshing", () => {
    const { queue } = connected();
    queue.replace(first, [first, second]);
    queue.setMode("shuffle");
    queue.commitSelection();
    queue.playNext([third, fourth]);
    queue.shuffle();

    const restored = connected().queue;
    expect(restored.advance(1, true)?.sourceTrackId).toBe("third");
    restored.commitSelection();
    expect(restored.advance(1, true)?.sourceTrackId).toBe("fourth");
  });

  it("keeps the current in-memory queue when reconnecting the same server", () => {
    const { queue, persistence } = connected();
    queue.enqueue([first, second, first]);
    queue.select(2);
    queue.setMode("repeat-all");
    const current = queue.snapshot();
    saved.delete(key);
    persistence.setServer(server);
    expect(queue.snapshot()).toEqual(current);
    expect(connected().queue.value).toMatchObject(queue.value);
  });
});
