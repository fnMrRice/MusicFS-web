import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "../../src/app/services";

const saved = new Map<string, string>();
const instances: Services[] = [];
const key = "musicfs:server%3Aa:user%3Ab:preferences";

beforeEach(() => {
  saved.clear();
  vi.stubGlobal("window", { location: { href: "https://musicfs.test/" } });
  vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => "probably" }) });
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => saved.get(name) ?? null,
    setItem: (name: string, value: string) => saved.set(name, value),
  });
});
afterEach(() => {
  instances.splice(0).forEach((services) => services.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function connect(user = "user:b", server = "server:a") {
  const services = new Services({} as HTMLElement);
  instances.push(services);
  vi.spyOn(services.authApi, "ready").mockResolvedValue({ product: "MusicFS", instanceId: server, apiVersion: "1", ready: true });
  vi.spyOn(services.authApi, "restore").mockResolvedValue({ user: { id: user, role: "owner" }, csrfToken: "csrf", expiresAt: "2099-01-01" });
  vi.spyOn(services.content, "online").mockResolvedValue([]);
  vi.spyOn(services.libraryApi, "providers").mockResolvedValue([]);
  vi.spyOn(services, "reloadPlaylists").mockResolvedValue(undefined);
  vi.spyOn(services.profile, "setUser").mockImplementation(() => {});
  await services.connect();
  expect(services.auth.value.session?.user.id).toBe(user);
  return services;
}

describe("persisted queue pinning", () => {
  it("defaults to an unpinned queue without saved preferences", async () => {
    const services = await connect();
    expect(services.preferences.value.queuePinned).toBe(false);
  });

  it("restores both pin states without changing lyrics, mute or other preferences", async () => {
    const first = await connect();
    first.preference({ volume: 0.32, lyricsPinned: true, mine: false });
    first.toggleMute();
    first.preference({ queuePinned: true });
    const preserved = { lyricsPinned: true, volume: 0, lastVolume: 0.32, mine: false };
    expect(JSON.parse(saved.get(key)!)).toMatchObject({ ...preserved, queuePinned: true });
    const restored = await connect();
    expect(restored.preferences.value).toMatchObject({ ...preserved, queuePinned: true });
    restored.preference({ queuePinned: false });
    expect(JSON.parse(saved.get(key)!)).toMatchObject({ ...preserved, queuePinned: false });
    const unpinned = await connect();
    expect(unpinned.preferences.value).toMatchObject({ ...preserved, queuePinned: false });
  });

  it.each(["true", 1, null])("does not treat invalid saved pin value %j as enabled", async (queuePinned) => {
    saved.set(key, JSON.stringify({ queuePinned }));
    const services = await connect();
    expect(services.preferences.value.queuePinned).toBe(false);
  });

  it("keeps the queue pin scoped to its server and account", async () => {
    const first = await connect();
    first.preference({ queuePinned: true });
    expect((await connect("user:c")).preferences.value.queuePinned).toBe(false);
    expect((await connect("user:b", "server:c")).preferences.value.queuePinned).toBe(false);
    expect((await connect()).preferences.value.queuePinned).toBe(true);
  });
});
