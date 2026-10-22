import { afterEach, expect, it } from "vitest";
import { setLanguage, tr } from "../../src/i18n";
import favorites from "../../src/i18n/favorites";

afterEach(() => setLanguage("browser"));
it("registers favorites messages in every supported language", () => {
  for (const [key, values] of Object.entries(favorites)) {
    for (const [index, language] of (["en", "zh-TW", "ja"] as const).entries()) {
      setLanguage(language); expect(tr(key)).toBe(values[index]); expect(tr(key).trim()).not.toBe("");
    }
  }
});
