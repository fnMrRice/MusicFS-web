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
  vi.spyOn(services.authApi, "ready").mockResolvedValue({ product: "MusicFS", instanceId: server, serverVersion: "0.1.0", apiVersion: "1", ready: true });
  vi.spyOn(services.authApi, "restore").mockResolvedValue({ user: { id: user, role: "owner" }, csrfToken: "csrf", expiresAt: "2099-01-01" });
  vi.spyOn(services.content, "online").mockResolvedValue([]);
  vi.spyOn(services.libraryApi, "providers").mockResolvedValue([]);
  vi.spyOn(services, "reloadPlaylists").mockResolvedValue(undefined);
  vi.spyOn(services.profile, "setUser").mockImplementation(() => {});
  await services.connect();
  expect(services.auth.value.session?.user.id).toBe(user);
  return services;
}

describe.each(["lyricsPinned", "queuePinned"] as const)("persisted %s preference", (field) => {
  it.each([undefined, "true", 1, null])("uses an unpinned panel for %j", async value => {
    saved.set(key, JSON.stringify({ [field]: value }));
    expect((await connect()).preferences.value[field]).toBe(false);
  });

  it("retains the other panel, mute state and display options across reconnects", async () => {
    const other = field === "lyricsPinned" ? "queuePinned" : "lyricsPinned";
    const first = await connect();
    first.preference({ volume: 0.32, [other]: true, mine: false, theme: "light", accent: "tianyi" });
    first.toggleMute();
    const preserved = { [other]: true, mine: false, theme: "light", accent: "tianyi" };
    for (const pinned of [true, false]) {
      first.preference({ [field]: pinned });
      expect(JSON.parse(saved.get(key)!)).toMatchObject({ ...preserved, [field]: pinned });
      expect((await connect()).preferences.value).toMatchObject({
        ...preserved, [field]: pinned, volume: 0, lastVolume: 0.32,
      });
    }
  });

  it("scopes the panel to the server and account", async () => {
    (await connect()).preference({ [field]: true });
    expect((await connect("user:c")).preferences.value[field]).toBe(false);
    expect((await connect("user:b", "server:c")).preferences.value[field]).toBe(false);
    expect((await connect()).preferences.value[field]).toBe(true);
  });
});
