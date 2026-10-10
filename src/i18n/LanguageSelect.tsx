import { languages, setLanguage, tr, useLocale } from "./index";

const names = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
};
export function LanguageSelect() {
  const { language } = useLocale();
  return (
    <label className="language-select">
      <span>{tr("语言")}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value as typeof language)}
      >
        {languages.map((value) => (
          <option key={value} value={value}>
            {value === "browser" ? tr("跟随浏览器") : names[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
