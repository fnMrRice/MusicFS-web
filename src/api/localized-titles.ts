export interface LocalizedTitle {
  language: string;
  title: string;
}

export function isLocalizedTitle(value: unknown): value is LocalizedTitle {
  return !!value && typeof value === "object" && "language" in value && typeof value.language === "string" &&
    "title" in value && typeof value.title === "string" && !!value.language.trim() && !!value.title.trim();
}

export function validLocalizedNames(names: LocalizedTitle[]) {
  if (names.length > 64) return false;
  const seen = new Set<string>();
  for (const { language, title } of names) {
    const text = title.trim();
    let tag = language.trim().toLowerCase();
    if (!text || [...text].length > 256 || /\p{Cc}/u.test(text) || tag.length > 63) return false;
    try {
      tag = Intl.getCanonicalLocales(tag)[0];
    } catch {
      // Intl 只识别 Unicode 区域标识，私用和旧式 BCP 47 标签交由服务端规范化。
      if (!/^(?:x|i|[a-z]{2,3})(?:-[a-z0-9]{1,8})+$/i.test(tag)) return false;
    }
    const key = JSON.stringify([tag, text.toLowerCase()]);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export function languageLabel(language: string, locale: string) {
  try { return new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? language; }
  catch { return language; }
}

export function mergeScrapedTitles(displayTitle: string, saved: LocalizedTitle[], candidate: {
  title: string; localizedTitles?: LocalizedTitle[];
}): LocalizedTitle[] {
  const result = [...saved];
  const fold = (text: string) => text.trim().toLowerCase();
  for (const entry of candidate.localizedTitles ?? []) {
    if (!result.some(existing => fold(existing.language) === fold(entry.language) && fold(existing.title) === fold(entry.title))) {
      result.push(entry);
    }
  }
  if (fold(candidate.title) !== fold(displayTitle) && !result.some(entry => fold(entry.title) === fold(candidate.title))) {
    result.push({ language: "und", title: candidate.title });
  }
  return result;
}
