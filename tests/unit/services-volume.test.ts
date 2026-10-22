import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "../../src/app/services";

const preferencesKey = "musicfs:server%3Aa:user%3Ab:preferences";
const saved = new Map<string, string>();
const instances: Services[] = [];

beforeEach(() => {
  saved.clear();
  vi.stubGlobal("window", { location: { href: "https://musicfs.test/" } });
  vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => "probably" }) });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
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
  vi.spyOn(services.authApi, "ready").mockResolvedValue({ product: "MusicFS", instanceId: "server:a", apiVersion: "1", ready: true });
  vi.spyOn(services.authApi, "restore").mockResolvedValue({ user: { id: "user:b", role: "owner" }, csrfToken: "csrf", expiresAt: "2099-01-01" });
  vi.spyOn(services.content, "online").mockResolvedValue([]);
  vi.spyOn(services.libraryApi, "providers").mockResolvedValue([]);
  vi.spyOn(services, "reloadPlaylists").mockResolvedValue(undefined);
  vi.spyOn(services.profile, "setUser").mockImplementation(() => {});
  const setVolume = vi.spyOn(services.player, "setVolume");
  await services.connect();
  expect(services.auth.value.session?.user.id).toBe("user:b");
  return { services, setVolume };
}

describe("persisted playback volume", () => {
  it("uses 80 percent with no saved preference and restores a saved positive volume", async () => {
    const first = await connect();
    expect(first.services.preferences.value).toMatchObject({ volume: 0.8, lastVolume: 0.8 });
    expect(first.setVolume).toHaveBeenLastCalledWith(0.8);
    first.services.preference({ volume: 0.37, theme: "dark", mine: false });
    expect(JSON.parse(saved.get(preferencesKey)!)).toMatchObject({ volume: 0.37, lastVolume: 0.37, theme: "dark", mine: false });
    const restored = await connect();
    expect(restored.services.preferences.value).toMatchObject({ volume: 0.37, lastVolume: 0.37, theme: "dark", mine: false });
    expect(restored.setVolume).toHaveBeenLastCalledWith(0.37);
  });

  it("persists zero and restores the last positive volume after refreshing while muted", async () => {
    const first = await connect();
    first.services.preference({ volume: 0.24 });
    first.services.toggleMute();
    expect(first.setVolume).toHaveBeenLastCalledWith(0);
    expect(JSON.parse(saved.get(preferencesKey)!)).toMatchObject({ volume: 0, lastVolume: 0.24 });
    const restored = await connect();
    expect(restored.services.preferences.value).toMatchObject({ volume: 0, lastVolume: 0.24 });
    expect(restored.setVolume).toHaveBeenLastCalledWith(0);
    restored.services.toggleMute();
    expect(restored.setVolume).toHaveBeenLastCalledWith(0.24);
    expect(JSON.parse(saved.get(preferencesKey)!)).toMatchObject({ volume: 0.24, lastVolume: 0.24 });
    restored.services.preference({ volume: 0.61 });
    restored.services.toggleMute(); restored.services.toggleMute();
    expect(restored.services.preferences.value).toMatchObject({ volume: 0.61, lastVolume: 0.61 });
  });

  it("remembers the previous positive volume when the slider is set to zero", async () => {
    const { services } = await connect();
    services.preference({ volume: 0.46 });
    services.preference({ volume: 0 });
    services.preference({ theme: "light" });
    expect(JSON.parse(saved.get(preferencesKey)!)).toMatchObject({ volume: 0, lastVolume: 0.46, theme: "light" });
    services.toggleMute();
    expect(services.preferences.value.volume).toBe(0.46);
  });

  it.each([
    [{ volume: 0.31 }, 0.31, 0.31],
    [{ volume: 0.37, lastVolume: 0.8 }, 0.37, 0.37],
    [{ volume: 0 }, 0, 0.8],
    [{ volume: 0, lastVolume: 0.52 }, 0, 0.52],
    [{ volume: 1, lastVolume: 0 }, 1, 1],
    [{ volume: 0.42, lastVolume: "0.6" }, 0.42, 0.42],
    [{ volume: 0, lastVolume: -1 }, 0, 0.8],
    [{ volume: 0, lastVolume: 2 }, 0, 0.8],
    [{ volume: "0.5" }, 0.8, 0.8],
    [{ volume: -0.2 }, 0.8, 0.8],
    [{ volume: 1.2 }, 0.8, 0.8],
    [{ volume: null }, 0.8, 0.8],
    [{}, 0.8, 0.8],
    [null, 0.8, 0.8],
  ])("normalizes saved volume %j", async (value, volume, lastVolume) => {
    saved.set(preferencesKey, JSON.stringify(value));
    const { services, setVolume } = await connect();
    expect(services.preferences.value).toMatchObject({ volume, lastVolume });
    expect(setVolume).toHaveBeenLastCalledWith(volume);
  });

  it("uses defaults for malformed saved JSON and keeps mute usable when storage is unavailable", async () => {
    saved.set(preferencesKey, "not JSON");
    const { services } = await connect();
    expect(services.preferences.value).toMatchObject({ volume: 0.8, lastVolume: 0.8 });
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("Storage unavailable"); } });
    services.preference({ volume: 0.2 });
    services.toggleMute(); services.toggleMute();
    expect(services.preferences.value).toMatchObject({ volume: 0.2, lastVolume: 0.2 });
  });
});
