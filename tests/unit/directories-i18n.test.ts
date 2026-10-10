import { afterEach, expect, it } from "vitest";
import directories from "../../src/i18n/directories";
import { setLanguage, statusText, tr } from "../../src/i18n";

afterEach(() => setLanguage("browser"));
it("registers complete directory translations and preserves folder names", () => {
  const parameters = (value: string) => [...value.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort();
  for (const [key, translations] of Object.entries(directories)) {
    for (const [index, language] of (["en", "zh-TW", "ja"] as const).entries()) {
      setLanguage(language);
      expect(translations[index].trim()).not.toBe("");
      expect(parameters(translations[index])).toEqual(parameters(key));
      expect(tr(key)).toBe(translations[index]);
      expect(statusText(key)).toBe(translations[index]);
    }
  }
  setLanguage("en");
  expect(tr("打开目录 {0}", { 0: "收藏 & Live" })).toBe("Open folder 收藏 & Live");
});
