import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "../../src/app/services";
import { track } from "../fixtures/dto";

const saved = new Map<string, string>();
const instances: Services[] = [];
const key = "musicfs:playback-queue:v1";

beforeEach(() => {
  saved.clear();
  vi.stubGlobal("window", { location: { href: "https://musicfs.test/" } });
  vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => "probably" }) });
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => saved.get(name) ?? null,
    setItem: (name: string, value: string) => saved.set(name, value),
    removeItem: (name: string) => saved.delete(name),
  });
});
afterEach(() => {
  instances.splice(0).forEach((services) => services.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function connect() {
  const services = new Services({} as HTMLElement);
  instances.push(services);
  vi.spyOn(services.authApi, "ready").mockResolvedValue({ product: "MusicFS", instanceId: "server", serverVersion: "0.1.0", apiVersion: "1", ready: true });
  vi.spyOn(services.authApi, "restore").mockResolvedValue({ user: { id: "user", role: "owner" }, csrfToken: "csrf", expiresAt: "2099-01-01" });
  vi.spyOn(services.content, "online").mockResolvedValue([]);
  vi.spyOn(services.libraryApi, "providers").mockResolvedValue([]);
  vi.spyOn(services, "reloadPlaylists").mockResolvedValue(undefined);
  vi.spyOn(services.profile, "setUser").mockImplementation(() => {});
  vi.spyOn(services.favorites, "load").mockResolvedValue(undefined);
  vi.spyOn(services.tasks, "start").mockImplementation(() => {});
  await services.connect();
  return services;
}

describe("temporary queue lifecycle", () => {
  it("restores the queue after reload without creating a playback session", async () => {
    const first = await connect();
    first.enqueue([track, { ...track, sourceTrackId: "second" }, track]);
    first.queue.select(2);
    first.setPlaybackMode("repeat-all");
    const restored = await connect();
    expect(restored.queue.value.items.map((item) => item.sourceTrackId)).toEqual([track.sourceTrackId, "second", track.sourceTrackId]);
    expect(restored.queue.value).toMatchObject({ index: 2, mode: "repeat-all" });
    expect(restored.player.state).toMatchObject({ phase: "paused", positionMs: 0, wantsPlay: false, playback: null });
    expect(restored.player.state.track).toBe(restored.queue.value.items[2]);
    expect(restored.currentTrack.value).toBe(track.sourceTrackId);
  });

  it("clears both saved and in-memory queues on logout", async () => {
    const services = await connect();
    services.enqueue([track]);
    vi.spyOn(services.authApi, "logout").mockResolvedValue(undefined);
    await services.logout();
    expect(saved.has(key)).toBe(false);
    expect(services.queue.value.items).toEqual([]);
    await services.connect();
    expect(services.queue.value.items).toEqual([]);
  });

  it("clears saved data when authentication expires", async () => {
    const services = await connect();
    services.enqueue([track]);
    services.client.onUnauthorized?.();
    expect(saved.has(key)).toBe(false);
    expect(services.queue.value.items).toEqual([]);
    expect(services.auth.value.session).toBeNull();
  });

  it("preserves navigation after a server restart but clears it when the API address changes", async () => {
    const services = await connect();
    const next = { ...track, sourceTrackId: "next" };
    services.enqueue([track]);
    services.queue.select(0);
    services.queue.commitSelection();
    services.setPlaybackMode("shuffle");
    services.playNext([next]);
    vi.mocked(services.authApi.ready).mockResolvedValue({ product: "MusicFS", instanceId: "restarted", serverVersion: "0.1.0", apiVersion: "1", ready: true });
    await services.connect();
    expect(services.queue.snapshot().priority).toEqual([1]);
    expect(services.queue.value.items).toEqual([track, next]);
    const url = vi.spyOn(services.client, "url").mockImplementation((path) => `/other/api/v1${path}`);
    await services.connect();
    expect(services.queue.value.items).toEqual([]);
    expect(saved.has(key)).toBe(false);
    url.mockRestore();
    await services.connect();
    expect(services.queue.value.items).toEqual([]);
  });

  it("keeps the saved queue during development hot reload cleanup", async () => {
    const first = await connect();
    first.enqueue([track]);
    first.clear({ preserveQueue: true });
    expect(first.queue.value.items).toEqual([]);
    expect(saved.has(key)).toBe(true);
    const restored = await connect();
    expect(restored.queue.value.items[0].sourceTrackId).toBe(track.sourceTrackId);
    expect(restored.player.state).toMatchObject({ phase: "idle", track: null, playback: null });
  });
});
