import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioOutputSettingsStore } from "../../src/app/audio-output-settings";
import { defaultAudioOutput } from "../../src/player/dsp/output";
import translations from "../../src/i18n/audio-output";
import { setLanguage, tr } from "../../src/i18n";

const saved = new Map<string, string>();
const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) };
beforeEach(() => { saved.clear(); vi.stubGlobal("localStorage", storage); });
afterEach(() => { vi.unstubAllGlobals(); setLanguage("browser"); });

describe("browser audio output preferences", () => {
  it("previews without persisting and reverts to the latest explicit save", () => {
    const store = new AudioOutputSettingsStore(true); store.setSession("a", "b");
    expect(store.value.config).toEqual({ layout: "source", expandStereo: false });
    store.update({ layout: "7.1", expandStereo: true });
    expect(store.value).toMatchObject({ dirty: true, saved: false });
    expect(saved.size).toBe(0);
    store.revert();
    expect(store.value.config).toEqual(defaultAudioOutput());
    store.update({ layout: "5.1", expandStereo: true });
    expect(store.save()).toBe(true);
    store.update({ layout: "mono", expandStereo: false });
    store.revert();
    expect(store.value).toMatchObject({ config: { layout: "5.1", expandStereo: true }, dirty: false, saved: false });
    store.clear(); store.setSession("a", "b");
    expect(store.value.config).toEqual({ layout: "5.1", expandStereo: true });
  });

  it("isolates accounts and instances while preserving an unchanged session draft", () => {
    const store = new AudioOutputSettingsStore(true); store.setSession("server:a", "user:b");
    store.update({ layout: "mono", expandStereo: false }); store.save();
    expect(saved.has("musicfs:audio-output:v1:server%3Aa:user%3Ab")).toBe(true);
    store.update({ layout: "stereo", expandStereo: true });
    store.setSession("server:a", "user:b");
    expect(store.value).toMatchObject({ config: { layout: "stereo", expandStereo: true }, dirty: true });
    store.setSession("server:a", "user:c");
    expect(store.value.config).toEqual(defaultAudioOutput());
    store.setSession("server:c", "user:b");
    expect(store.value.config).toEqual(defaultAudioOutput());
    store.setSession("server:a", "user:b");
    expect(store.value.config).toEqual({ layout: "mono", expandStereo: false });
    store.clear();
    expect(store.value).toMatchObject({ config: defaultAudioOutput(), dirty: false, saved: false });
    expect(saved.size).toBe(1);
  });

  it("keeps high-channel preferences and the save state when device capacity changes", () => {
    const store = new AudioOutputSettingsStore(true); store.setSession("a", "b");
    store.update({ layout: "7.1", expandStereo: true }); store.save();
    const config = store.value.config;
    store.reportStatus({ supported: true, maxChannels: 2, sourceChannels: 6, outputChannels: 2, limited: true });
    expect(store.value.config).toBe(config);
    expect(store.value).toMatchObject({ dirty: false, saved: true });
    expect(JSON.parse(saved.get("musicfs:audio-output:v1:a:b")!)).toEqual(config);
    store.update({ layout: "5.1", expandStereo: true });
    store.reportStatus({ supported: true, maxChannels: 8, sourceChannels: 2, outputChannels: 6, limited: false });
    expect(store.value).toMatchObject({ config: { layout: "5.1", expandStereo: true }, dirty: true, saved: false });
  });

  it("retains drafts after storage errors and can repair corrupt saved settings", () => {
    saved.set("musicfs:audio-output:v1:a:b", "invalid");
    const store = new AudioOutputSettingsStore(false); store.setSession("a", "b");
    expect(store.value.storageError).toBe("无法读取输出设置，已使用默认值。");
    expect(store.value.status.supported).toBe(false);
    const config = { layout: "mono", expandStereo: false } as const;
    store.update(config);
    vi.stubGlobal("localStorage", { ...storage, setItem: () => { throw new Error("Full"); } });
    expect(store.save()).toBe(false);
    expect(store.value).toMatchObject({ config, dirty: true, saved: false });
    store.revert();
    expect(store.value.config).toEqual(defaultAudioOutput());
    expect(store.value.storageError).toBeTruthy();
    store.update(config); vi.stubGlobal("localStorage", storage);
    expect(store.save()).toBe(true);
    expect(store.value).toMatchObject({ dirty: false, saved: true, storageError: null });
    store.clear(); store.setSession("a", "b");
    expect(store.value.config).toEqual(config);
  });

  it("does not persist without a session or import server output preferences", () => {
    const store = new AudioOutputSettingsStore(true);
    store.update({ layout: "mono", expandStereo: false });
    expect(store.save()).toBe(false); expect(saved.size).toBe(0);
    saved.set("musicfs:audio-output:v1:a:b", JSON.stringify({ outputLayout: "7.1", chain: [{ name: "gain" }] }));
    store.setSession("a", "b");
    expect(store.value.config).toEqual(defaultAudioOutput());
  });
});

it("registers output settings translations with intact placeholders", () => {
  const params = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(([key]) => key).sort();
  for (const [key, values] of Object.entries(translations)) {
    for (const [index, locale] of (["en", "zh-TW", "ja"] as const).entries()) {
      setLanguage(locale); expect(tr(key)).toBe(values[index]); expect(params(values[index])).toEqual(params(key));
    }
  }
});
