import { tr } from "../i18n";
const names = new Map([
  ["netease", "网易云音乐"],
  ["netease-public", "网易云音乐"],
  ["网易云公开资料", "网易云音乐"],
  ["qqmusic", "QQ音乐"],
  ["qq-public", "QQ音乐"],
  ["qqmusic-public", "QQ音乐"],
  ["QQ音乐公开资料", "QQ音乐"],
  ["applemusic", "Apple Music"],
  ["apple-public", "Apple Music"],
  ["applemusic-public", "Apple Music"],
  ["Apple Music公开资料", "Apple Music"],
]);

// Keep API identifiers intact; normalize only labels shown to listeners.
export function sourceName(
  source:
    | string
    | {
        platform?: string;
        name?: string;
        instanceId?: string;
        id?: string;
      },
): string {
  if (typeof source === "string")
    return names.has(source) ? tr(names.get(source)!) : source;
  for (const key of [
    source.platform,
    source.name,
    source.instanceId,
    source.id,
  ]) {
    const name = key && names.get(key);
    if (name) return tr(name);
  }
  return source.name || source.instanceId || source.id || tr("未知来源");
}
