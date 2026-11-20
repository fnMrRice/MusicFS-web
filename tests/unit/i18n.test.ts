import { afterEach, describe, expect, it } from "vitest";
import { detectLocale, setLanguage, statusText, tr } from "../../src/i18n";
import common from "../../src/i18n/common";
import music from "../../src/i18n/music";
import categories from "../../src/i18n/categories";
import recordingCover from "../../src/i18n/recording-cover";
import notices from "../../src/i18n/notices";
import { sourceName } from "../../src/components/source-name";

describe("Language selection and messages", () => {
  afterEach(() => setLanguage("browser"));

  it("matches browser preferences in order, with Chinese region and script support", () => {
    for (const tag of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-CN"])
      expect(detectLocale([tag])).toBe("zh-TW");
    for (const tag of ["zh", "zh-CN", "zh-SG", "zh-Hans-HK"])
      expect(detectLocale([tag])).toBe("zh-CN");
    expect(detectLocale(["fr-FR", "ja-JP", "en-US"])).toBe("ja");
    expect(detectLocale(["en-GB", "zh-CN"])).toBe("en");
    expect(detectLocale(["de-DE"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });

  it("translates saved status messages after language changes", () => {
    const message = "已将 12 首可用曲目加入队列";
    setLanguage("en");
    expect(statusText(message)).toBe("Added 12 available tracks to the queue");
    expect(statusText("请求超时，请重试。 请求编号：req-12")).toBe(
      "The request timed out. Please try again. Request ID: req-12",
    );
    expect(statusText("Apple Music 返回 HTTP 429（请求过多）。 可在 3 秒后重试。 请求编号：req-12")).toBe(
      "Apple Music returned HTTP 429 (too many requests). You can retry in 3 seconds. Request ID: req-12",
    );
    setLanguage("ja");
    expect(statusText(message)).toBe("再生可能な 12 曲をキューに追加しました");
    setLanguage("zh-TW");
    expect(tr("搜索")).toBe("搜尋");
    setLanguage("zh-CN");
    expect(statusText(message)).toBe(message);
  });

  it("preserves metadata and parameter values without translating them", () => {
    setLanguage("en");
    expect(tr("播放 {0}", { 0: "搜索 <script>{0}</script>" })).toBe(
      "Play 搜索 <script>{0}</script>",
    );
    expect(sourceName({ platform: "netease", name: "网易云公开资料" })).toBe(
      "Unknown source",
    );
    expect(sourceName({ id: "custom", name: "我的音乐目录" })).toBe(
      "Unknown source",
    );
  });

  it("has complete translations with matching interpolation parameters", () => {
    const groups = [common, music, notices, categories, recordingCover];
    const all = groups.flatMap((group) => Object.entries(group));
    expect(new Set(all.map(([key]) => key)).size).toBe(all.length);
    const parameters = (value: string) =>
      [...value.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort();
    for (const [key, translations] of all) {
      expect(translations, key).toHaveLength(3);
      for (const translation of translations) {
        expect(translation.trim(), key).not.toBe("");
        expect(parameters(translation), key).toEqual(parameters(key));
      }
    }
  });
});
