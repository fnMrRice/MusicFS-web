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
  it("previews edits without persistence and saves only on explicit request", () => {
    const store = new LocalDSPSettingsStore(true);
    store.setSession("server:a", "user:b");
    const gain = createLocalDSPNode("gain");
    gain.params.gain = -6;
    const config = { enabled: true, chain: [gain] };
    store.update(config);
    expect(store.value.config).toEqual(config);
    expect(store.value).toMatchObject({ dirty: true, saved: false });
    expect(saved.size).toBe(0);
    const reopened = new LocalDSPSettingsStore(true);
    reopened.setSession("server:a", "user:b");
    expect(reopened.value.config).toEqual(defaultLocalDSP());
    expect(store.save()).toBe(true);
    expect(store.value).toMatchObject({ dirty: false, saved: true, storageError: null });
    expect(saved.size).toBe(1);
    reopened.clear(); reopened.setSession("server:a", "user:b");
    expect(reopened.value.config).toEqual(config);
    expect(reopened.value).toMatchObject({ dirty: false, saved: false });
    store.update({ ...config, enabled: false });
    expect(store.value).toMatchObject({ dirty: true, saved: false });
    expect(JSON.parse([...saved.values()][0])).toEqual(config);
  });

  it("isolates saved preferences and unsaved drafts across accounts, instances, and logout", () => {
    const store = new LocalDSPSettingsStore(true);
    const config = { enabled: true, chain: [createLocalDSPNode("gain")] };
    store.setSession("server:a", "user:b"); store.update(config); store.save();
    store.update({ ...config, enabled: false });
    store.setSession("server:a", "user:c");
    expect(store.value.config).toEqual(defaultLocalDSP());
    expect(store.value).toMatchObject({ dirty: false, saved: false });
    store.update({ enabled: false, chain: [] }); store.save();
    store.setSession("server:c", "user:b");
    expect(store.value.config).toEqual(defaultLocalDSP());
    store.setSession("server:a", "user:b");
    expect(store.value.config).toEqual(config);
    store.update({ enabled: false, chain: [] });
    store.clear();
    expect(store.value.config).toEqual(defaultLocalDSP());
    expect(store.value).toMatchObject({ dirty: false, saved: false });
    expect(saved.size).toBe(2);
    store.setSession("server:a", "user:b");
    expect(store.value.config).toEqual(config);
    store.setSession("server:a", "user:c");
    expect(store.value.config).toEqual({ enabled: false, chain: [] });
  });

  it("keeps repeated effect identities, order, and bypass switches", () => {
    const store = new LocalDSPSettingsStore(true);
    store.setSession("a", "b");
    const first = createLocalDSPNode("equalizer"), second = createLocalDSPNode("equalizer");
    second.enabled = false; second.params.frequency = 2500;
    store.update({ enabled: false, chain: [second, first] });
    expect(store.save()).toBe(true);
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
    expect(store.value.dirty).toBe(false);
    store.update(store.value.config);
    expect(store.value).toMatchObject({ dirty: false, saved: false });
    store.update(defaultLocalDSP()); store.revert();
    expect(store.value.config.chain[0].params.gain).toBe(12);
    expect(store.value).toMatchObject({ dirty: false, saved: false });
  });

  it("reverts to the latest saved baseline and recognizes edits returned to that baseline", () => {
    const store = new LocalDSPSettingsStore(true); store.setSession("a", "b");
    const gain = createLocalDSPNode("gain"); gain.params.gain = -6;
    const config = { enabled: true, chain: [gain] };
    store.update(config); store.save();
    gain.params.gain = -12;
    store.update(config);
    expect(store.value.dirty).toBe(true);
    store.revert();
    expect(store.value.config.chain[0].params.gain).toBe(-6);
    expect(store.value).toMatchObject({ dirty: false, saved: false });
    store.update({ ...config, enabled: false }); store.save();
    store.update(defaultLocalDSP()); store.revert();
    expect(store.value.config).toEqual({ ...config, enabled: false });
    store.update({ ...config, enabled: true });
    expect(store.value.dirty).toBe(true);
    store.update({ ...config, enabled: false });
    expect(store.value).toMatchObject({ dirty: false, saved: false });
  });

  it("keeps drafts and the previous baseline after a failed save and supports retry", () => {
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
    expect(store.save()).toBe(false);
    expect(store.value).toMatchObject({ config, dirty: true, saved: false });
    expect(store.value.storageError).toContain("刷新后可能丢失");
    store.reportError("DSP failure");
    store.update({ ...config, enabled: false });
    expect(store.value.error).toBe("DSP failure");
    store.reportError(null);
    expect(store.value.error).toBeNull();
    store.revert();
    expect(store.value).toMatchObject({ config: defaultLocalDSP(), dirty: false, saved: false, storageError: null });
    store.update(config);
    expect(store.save()).toBe(false);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    });
    expect(store.save()).toBe(true);
    expect(store.value).toMatchObject({ config, dirty: false, saved: true, storageError: null });
    expect(JSON.parse(saved.get("musicfs:local-dsp:v1:c:d")!)).toEqual(config);
  });

  it("does not save changes without a session and does not reload the same session", () => {
    const store = new LocalDSPSettingsStore(true);
    store.update({ enabled: false, chain: [] });
    expect(store.save()).toBe(false);
    expect(store.value).toMatchObject({ dirty: true, saved: false });
    expect(saved.size).toBe(0);
    store.setSession("a:b", "c");
    store.update({ enabled: false, chain: [] });
    store.setSession("a:b", "c");
    expect(store.value.config.enabled).toBe(false);
    expect(store.value.dirty).toBe(true);
    expect(store.save()).toBe(true);
    store.setSession("a:b", "c");
    expect(store.value).toMatchObject({ dirty: false, saved: false });
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
    for (const parameter of effect.params) {
      if (/\p{Script=Han}/u.test(parameter.label)) expect(tr(parameter.label)).not.toBe(parameter.label);
      else expect(tr(parameter.label)).toBe(parameter.label);
    }
  }
});
