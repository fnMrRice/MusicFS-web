import type { PluginIdentity } from "../api/types";
import { tr } from "../i18n";

export type SourceLabel = string | {
  platform?: string;
  name?: string;
  instanceId?: string;
  id?: string;
  plugin?: PluginIdentity;
};

function localeTag(value: string): Intl.Locale | null {
  try { return new Intl.Locale(value.replaceAll("_", "-")); }
  catch { return null; }
}

/** Plugin-owned names never pass through the application's message dictionary. */
export function pluginName(plugin: PluginIdentity, locale: string): string {
  const target = localeTag(locale);
  const translations = Object.entries(plugin.localizedNames ?? {})
    .filter(([, name]) => typeof name === "string" && name.trim())
    .map(([tag, name]) => ({ tag: localeTag(tag), name }))
    .filter((entry): entry is { tag: Intl.Locale; name: string } => !!entry.tag)
    .sort((a, b) => a.tag.baseName.localeCompare(b.tag.baseName));
  if (target) {
    const script = target.maximize().script;
    for (const tag of [target.baseName, `${target.language}-${script}`, target.language]) {
      const exact = translations.find((entry) => entry.tag.baseName === tag);
      if (exact) return exact.name;
    }
    const related = translations.find(({ tag }) =>
      tag.language === target.language && tag.maximize().script === script);
    if (related) return related.name;
  }
  return plugin.name || tr("未知来源");
}

// Request identifiers stay unchanged. Online instance aliases are not display names.
export function sourceName(
  source: SourceLabel,
  instances: readonly Exclude<SourceLabel, string>[] = [],
  locale = "en",
): string {
  const instanceId = typeof source === "string" ? source : source.instanceId ?? source.id;
  const instance = instances.find((item) => (item.instanceId ?? item.id) === instanceId);
  const plugin = instance ? instance.plugin : typeof source === "string" ? undefined : source.plugin;
  if (plugin) return pluginName(plugin, locale);
  return tr("未知来源");
}
