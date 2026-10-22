import { useSyncExternalStore } from "react";
import common from "./common";
import music from "./music";
import favorites from "./favorites";
import notices from "./notices";
import plugins from "./plugins";
import directories from "./directories";
import scans from "./scans";
import matching from "./matching";
import pluginSettings from "./plugin-settings";
import dsp from "./dsp";
import localDSP from "./local-dsp";
import graphicEqualizer from "./graphic-equalizer";
import workNavigation from "./work-navigation";

export type Locale = "en" | "zh-CN" | "zh-TW" | "ja";
export type Language = "browser" | Locale;
const storageKey = "musicfs:language";
const messages: Record<string, readonly string[]> = {
  ...common,
  ...music,
  ...favorites,
  ...notices,
  ...plugins,
  ...directories,
  ...scans,
  ...matching,
  ...pluginSettings,
  ...dsp,
  ...localDSP,
  ...graphicEqualizer,
  ...workNavigation,
};
const columns: Record<Locale, number> = {
  en: 0,
  "zh-CN": -1,
  "zh-TW": 1,
  ja: 2,
};
export const languages: readonly Language[] = [
  "browser",
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
];

export function detectLocale(preferences: readonly string[]): Locale {
  for (const preference of preferences) {
    const tag = preference.toLowerCase().replaceAll("_", "-");
    if (/^zh(?:-|$)/.test(tag)) {
      if (tag.includes("-hant")) return "zh-TW";
      if (tag.includes("-hans")) return "zh-CN";
      return /-(tw|hk|mo)(?:-|$)/.test(tag) ? "zh-TW" : "zh-CN";
    }
    if (/^en(?:-|$)/.test(tag)) return "en";
    if (/^ja(?:-|$)/.test(tag)) return "ja";
  }
  return "en";
}

function savedLanguage(): Language {
  if (typeof window === "undefined") return "browser";
  try {
    const saved = localStorage.getItem(storageKey) as Language;
    if (languages.includes(saved)) return saved;
  } catch {
    /* Storage may be unavailable. */
  }
  return "browser";
}
function resolve(language: Language): Locale {
  return language === "browser"
    ? detectLocale(
        typeof navigator === "undefined"
          ? []
          : navigator.languages?.length
            ? navigator.languages
            : [navigator.language],
      )
    : language;
}
let language = savedLanguage();
let snapshot = { language, locale: resolve(language) };
const listeners = new Set<() => void>();
function refresh() {
  const locale = resolve(language);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  if (snapshot.language === language && snapshot.locale === locale) return;
  snapshot = { language, locale };
  listeners.forEach((listener) => listener());
}
export function setLanguage(value: Language) {
  if (!languages.includes(value)) return;
  language = value;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      /* Keep the in-memory preference. */
    }
  }
  refresh();
}
if (typeof window !== "undefined") {
  refresh();
  window.addEventListener("languagechange", refresh);
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) {
      language = savedLanguage();
      refresh();
    }
  });
}
export function useLocale() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
  );
}

export function tr(
  key: string,
  values?: Record<string, string | number>,
): string {
  const column = columns[snapshot.locale];
  const message = column < 0 ? key : (messages[key]?.[column] ?? key);
  return values
    ? message.replace(/\{(\w+)\}/g, (match, name) =>
        String(values[name] ?? match),
      )
    : message;
}

// Status messages can be stored before the user changes language.
const templates = Object.keys(messages)
  .filter((key) => /\{\w+\}/.test(key))
  .map((key) => {
    const names: string[] = [];
    const pattern = key
      .split(/(\{\w+\})/)
      .map((part) => {
        if (/^\{\w+\}$/.test(part)) {
          names.push(part.slice(1, -1));
          return "([\\s\\S]*?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return { key, names, pattern: new RegExp(`^${pattern}$`) };
  });
export function statusText(message: string): string {
  if (messages[message]) return tr(message);
  for (const template of templates) {
    const match = template.pattern.exec(message);
    if (match)
      return tr(
        template.key,
        Object.fromEntries(
          template.names.map((name, index) => [
            name,
            statusText(match[index + 1]),
          ]),
        ),
      );
  }
  return message;
}
export function formatDate(value: string): string {
  return new Date(value).toLocaleString(snapshot.locale);
}
