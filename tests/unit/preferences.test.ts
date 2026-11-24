import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesStore } from "../../src/app/preferences";
import { defaultFadeSettings } from "../../src/player/playback-transitions";

const key = "musicfs:server:user:preferences";
const saved = new Map<string, string>();

beforeEach(() => {
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => saved.get(name) ?? null,
    setItem: (name: string, value: string) => saved.set(name, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("playback and display preferences", () => {
  it("uses current fade settings and defaults when only obsolete fields remain", () => {
    const prefs = new PreferencesStore();
    saved.set(key, JSON.stringify({ fadeEnabled: false, fadeDurationMs: 900, theme: "dark" }));
    prefs.load("server", "user");
    expect(prefs.value).toMatchObject({ fades: defaultFadeSettings, theme: "dark" });
    const fades = { enabled: false, trackMs: 0, pauseMs: 200, seekMs: 1400 };
    prefs.update({ fades });
    prefs.load("server", "user");
    expect(prefs.value.fades).toEqual(fades);
    expect(JSON.parse(saved.get(key)!)).not.toHaveProperty("fadeDurationMs");
  });

  it("persists volume, recommendation order and account settings in their own scopes", () => {
    const prefs = new PreferencesStore();
    prefs.load("server", "user");
    prefs.update({ volume: 0.4, collapsedRecommendations: ["one"] });
    expect(saved.has(key)).toBe(false);
    prefs.update({ theme: "light" });
    const general = JSON.parse(saved.get(key)!);
    expect(general.theme).toBe("light");
    for (const field of ["volume", "lastVolume", "collapsedRecommendations", "recommendationOrder"])
      expect(general).not.toHaveProperty(field);
    prefs.reset();
    prefs.load("server", "other");
    expect(prefs.value).toMatchObject({ volume: 0.4, theme: "system", collapsedRecommendations: [] });
    prefs.load("server", "user");
    expect(prefs.value).toMatchObject({ volume: 0.4, theme: "light", collapsedRecommendations: ["one"] });
  });
});
