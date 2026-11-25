import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "../../src/app/services";
import { track } from "../fixtures/dto";

const saved = new Map<string, string>();
const instances: Services[] = [];
const key = "musicfs:playback-queue:v1";
const session = { user: { id: "user", role: "owner" }, csrfToken: "csrf", expiresAt: "2099-01-01" };

beforeEach(() => {
  saved.clear();
  vi.stubGlobal("window", { location: { href: "https://musicfs.test/" } });
  vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => "probably" }) });
  vi.stubGlobal("WebSocket", class extends EventTarget { close() {} });
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

function createServices() {
  const services = new Services({} as HTMLElement);
  instances.push(services);
  vi.spyOn(services.authApi, "ready").mockResolvedValue({ product: "MusicFS", instanceId: "server", serverVersion: "0.1.0", apiVersion: "1", ready: true });
  vi.spyOn(services.authApi, "restore").mockResolvedValue(session);
  vi.spyOn(services.authApi, "login").mockResolvedValue(session);
  vi.spyOn(services.content, "online").mockResolvedValue([]);
  vi.spyOn(services.libraryApi, "providers").mockResolvedValue([]);
  vi.spyOn(services, "reloadPlaylists").mockResolvedValue(undefined);
  vi.spyOn(services.profile, "setUser").mockImplementation(() => {});
  vi.spyOn(services.favorites, "load").mockResolvedValue(undefined);
  vi.spyOn(services.tasks, "start").mockImplementation(() => {});
  return services;
}

async function connect() {
  const services = createServices();
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

  it("restores the selected occurrence, shuffle mode and play-next entries after an HTTP 401 and login", async () => {
    const services = await connect();
    services.enqueue([track, { ...track, sourceTrackId: "second" }, track]);
    services.setPlaybackMode("shuffle");
    services.queue.select(2);
    services.queue.commitSelection();
    services.playNext([{ ...track, sourceTrackId: "next" }]);
    vi.stubGlobal("fetch", async () => Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }));
    await expect(services.client.request("/works")).rejects.toMatchObject({ status: 401 });
    expect(services.auth.value.session).toBeNull();
    await services.login("token");
    expect(services.queue.value.items.map(item => item.sourceTrackId)).toEqual([track.sourceTrackId, "second", track.sourceTrackId, "next"]);
    expect(services.queue.snapshot()).toMatchObject({ index: 2, mode: "shuffle", priority: [3] });
    expect(services.player.state).toMatchObject({ phase: "paused", playback: null, wantsPlay: false });
    expect(services.player.state.track).toBe(services.queue.value.items[2]);
  });

  it("keeps an empty queue's playback mode when an expired cookie is discovered on page load", async () => {
    const previous = await connect();
    previous.setPlaybackMode("repeat-one");
    previous.clear();
    const fresh = createServices();
    vi.mocked(fresh.authApi.restore).mockRestore();
    vi.stubGlobal("fetch", async () => Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }));
    await fresh.connect();
    expect(fresh.auth.value.session).toBeNull();
    await fresh.login("token");
    expect(fresh.queue.value).toEqual({ items: [], index: -1, mode: "repeat-one" });
  });

  it.each(["user", "other"])("isolates the in-memory fallback when %s logs in after a failed storage write", async userId => {
    const services = await connect();
    services.enqueue([track]);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    services.enqueue([{ ...track, sourceTrackId: "second" }]);
    services.setPlaybackMode("repeat-all");
    services.client.onUnauthorized?.();
    services.client.onUnauthorized?.();
    vi.mocked(services.authApi.login).mockResolvedValue({ ...session, user: { ...session.user, id: userId } });
    await services.login("token");
    expect(services.queue.value.items.map(item => item.sourceTrackId)).toEqual(userId === "user" ? [track.sourceTrackId, "second"] : []);
    expect(services.queue.value.mode).toBe(userId === "user" ? "repeat-all" : "sequence");
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
    first.clear();
    expect(first.queue.value.items).toEqual([]);
    expect(saved.has(key)).toBe(true);
    const restored = await connect();
    expect(restored.queue.value.items[0].sourceTrackId).toBe(track.sourceTrackId);
    expect(restored.player.state).toMatchObject({ phase: "idle", track: null, playback: null });
  });
});
