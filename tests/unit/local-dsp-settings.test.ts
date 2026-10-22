import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalDSPSettingsStore } from "../../src/app/local-dsp-settings";
import { createLocalDSPNode, defaultLocalDSP, localDSPCatalog } from "../../src/player/dsp/model";
import translations from "../../src/i18n/local-dsp";
import { setLanguage, tr } from "../../src/i18n";

const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
});
afterEach(() => { vi.unstubAllGlobals(); setLanguage("browser"); });

describe("browser local DSP settings", () => {
  it("persists edits immediately and isolates instances and accounts without deleting preferences on logout", () => {
    const store = new LocalDSPSettingsStore(true);
    store.setSession("server:a", "user:b");
    const gain = createLocalDSPNode("gain");
    gain.params.gain = -6;
    const config = { enabled: true, chain: [gain] };
    store.update(config);
    expect(store.value.config).toEqual(config);
    store.clear();
    expect(store.value.config).toEqual(defaultLocalDSP());
    expect(saved.size).toBe(1);
    store.setSession("server:a", "user:c");
    expect(store.value.config).toEqual(defaultLocalDSP());
    store.setSession("server:c", "user:b");
    expect(store.value.config).toEqual(defaultLocalDSP());
    store.setSession("server:a", "user:b");
    expect(store.value.config).toEqual(config);
    const reopened = new LocalDSPSettingsStore(true);
    reopened.setSession("server:a", "user:b");
    expect(reopened.value.config).toEqual(config);
  });

  it("keeps repeated effect identities, order, and bypass switches", () => {
    const store = new LocalDSPSettingsStore(true);
    store.setSession("a", "b");
    const first = createLocalDSPNode("equalizer"), second = createLocalDSPNode("equalizer");
    second.enabled = false; second.params.frequency = 2500;
    store.update({ enabled: false, chain: [second, first] });
    store.clear(); store.setSession("a", "b");
    expect(store.value.config).toEqual({ enabled: false, chain: [second, first] });
  });

  it("normalizes persisted parameters and ignores server DSP shapes", () => {
    saved.set("musicfs:local-dsp:v1:a:b", JSON.stringify({ enabled: true, chain: [
      { id: "local", kind: "gain", params: { gain: 100, unknown: 2 } },
      { name: "gain", version: 1, params: { gainDB: -12 } },
    ] }));
    const store = new LocalDSPSettingsStore(true); store.setSession("a", "b");
    expect(store.value.config.chain).toEqual([{ id: "local", kind: "gain", enabled: true, params: { gain: 12 } }]);
  });

  it("shows corrupt data and storage failures while keeping current edits", () => {
    saved.set("musicfs:local-dsp:v1:a:b", "not JSON");
    const store = new LocalDSPSettingsStore(false); store.setSession("a", "b");
    expect(store.value.config).toEqual(defaultLocalDSP());
    expect(store.value.storageError).toBe("无法读取本地音效设置，已使用默认值。");
    expect(store.value.supported).toBe(false);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Blocked"); }, setItem: () => { throw new Error("Full"); } });
    store.setSession("c", "d");
    expect(store.value.storageError).toBeTruthy();
    const config = { enabled: true, chain: [createLocalDSPNode("gain")] };
    store.update(config);
    expect(store.value.config).toEqual(config);
    expect(store.value.storageError).toContain("刷新后可能丢失");
    store.reportError("DSP failure");
    store.update({ ...config, enabled: false });
    expect(store.value.error).toBe("DSP failure");
    store.reportError(null);
    expect(store.value.error).toBeNull();
  });

  it("does not save changes without a session and does not reload the same session", () => {
    const store = new LocalDSPSettingsStore(true);
    store.update({ enabled: false, chain: [] });
    expect(saved.size).toBe(0);
    store.setSession("a:b", "c");
    store.update({ enabled: false, chain: [] });
    store.setSession("a:b", "c");
    expect(store.value.config.enabled).toBe(false);
    store.setSession("a", "b:c");
    expect(store.value.config.enabled).toBe(true);
  });
});

it("registers local effect and parameter translations with placeholders intact", () => {
  const params = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(([key]) => key).sort();
  for (const [key, values] of Object.entries(translations)) {
    for (const [index, locale] of (["en", "zh-TW", "ja"] as const).entries()) {
      setLanguage(locale); expect(tr(key)).toBe(values[index]); expect(params(values[index])).toEqual(params(key));
    }
  }
  setLanguage("en");
  for (const effect of localDSPCatalog) {
    expect(tr(effect.name)).not.toBe(effect.name);
    expect(tr(effect.description)).not.toBe(effect.description);
    for (const parameter of effect.params) expect(tr(parameter.label)).not.toBe(parameter.label);
  }
});
