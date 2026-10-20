import { instanceIds } from "../fixtures/plugins";
import { afterEach, describe, expect, it } from "vitest";
import type { OnlineInstance, PluginIdentity } from "../../src/api/content";
import { pluginName, sourceName } from "../../src/components/source-name";
import { setLanguage } from "../../src/i18n";

const plugin: PluginIdentity = {
  id: "org.example.music",
  features: ["music-source"],
  name: "Example Music",
  localizedNames: { "zh-CN": "示例音乐", "zh-Hant": "示例音樂", "ja-JP": "サンプル音楽" },
};
const instance: OnlineInstance = {
  instanceId: instanceIds.custom, name: "Private instance alias", platform: "custom",
  plugin, availability: "available", capabilities: [],
};

describe("Plugin-owned source labels", () => {
  afterEach(() => setLanguage("browser"));

  it("uses arbitrary plugin names and translations while preserving all request identifiers", () => {
    const before = structuredClone(instance);
    expect(sourceName(instance, [instance], "zh-CN")).toBe("示例音乐");
    expect(sourceName(instance.instanceId, [instance], "zh-TW")).toBe("示例音樂");
    expect(sourceName({ instanceId: instance.instanceId, name: "Recommendation alias" }, [instance], "ja"))
      .toBe("サンプル音楽");
    expect(sourceName(instance, [instance], "en")).toBe("Example Music");
    expect(instance).toEqual(before);
  });

  it("prefers exact locales, then script, language, and compatible regional translations", () => {
    const translated = { ...plugin, localizedNames: { "ZH_tw": "Exact", "zh-Hant": "Script", zh: "Language" } };
    expect(pluginName(translated, "zh-TW")).toBe("Exact");
    expect(pluginName(translated, "zh-HK")).toBe("Script");
    expect(pluginName(translated, "zh-CN")).toBe("Language");
    expect(pluginName({ ...plugin, localizedNames: { "zh-HK": "Traditional" } }, "zh-TW")).toBe("Traditional");
    expect(pluginName({ ...plugin, localizedNames: { "en-GB": "British name" } }, "en")).toBe("British name");
    expect(pluginName({ ...plugin, localizedNames: { "zh-CN": "简体中文" } }, "zh-TW")).toBe(plugin.name);
  });

  it("ignores invalid or empty translations and never translates the plugin's default name", () => {
    setLanguage("ja");
    expect(pluginName({ ...plugin, name: "搜索", localizedNames: { "bad tag": "Invalid", ja: " " } }, "ja"))
      .toBe("搜索");
    expect(pluginName({ ...plugin, localizedNames: {} }, "invalid locale")).toBe(plugin.name);
  });

  it("does not expose configured aliases when plugin metadata is unavailable or removed", () => {
    setLanguage("en");
    const offline = { ...instance, availability: "offline", plugin: undefined };
    for (const source of [offline, instance.instanceId, { instanceId: instance.instanceId, name: instance.name }])
      expect(sourceName(source, [offline], "en")).toBe("Unknown source");
    expect(sourceName(instance, [offline], "en")).toBe("Unknown source");
    expect(sourceName({ platform: "netease", name: "网易云公开资料" })).toBe("Unknown source");
    expect(sourceName(instanceIds.qqmusic)).toBe("Unknown source");
    expect(sourceName(instanceIds.applemusic)).toBe("Unknown source");
    expect(sourceName({ id: instanceIds.local, name: "我的音乐目录" })).toBe("Unknown source");
    const offlineNamed = { ...instance, availability: "offline" };
    expect(sourceName(offlineNamed, [], "en")).toBe(plugin.name);
    expect(sourceName(instanceIds.local, [{ id: instanceIds.local, name: "Private local alias", plugin }], "zh-CN"))
      .toBe("示例音乐");
  });

  it("shows the bound account username with the localized plugin alias without exposing UUIDs", () => {
    const account = { ...instance, accountId: "account-a", name: "Alice" };
    expect(sourceName(account, [], "zh-CN")).toBe("示例音乐 · Alice");
    expect(sourceName(account.instanceId, [account], "zh-TW")).toBe("示例音樂 · Alice");
    expect(sourceName({ ...account, name: "   " }, [], "en")).toBe("Example Music");
    expect(sourceName({ ...account, name: account.instanceId }, [], "en")).toBe("Example Music");
    expect(sourceName({ ...account, name: plugin.name }, [], "zh-CN")).toBe("示例音乐");
    expect(sourceName({ ...account, name: "示例音乐" }, [], "zh-CN")).toBe("示例音乐");
    expect(sourceName(account, [{ ...account, accountId: undefined, name: "Private alias" }], "en")).toBe("Example Music");
  });
});
