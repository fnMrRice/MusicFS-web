import { ScrapersApi, type ScrapeCandidate, type ScraperQuery } from "../../api/scrapers";
import { tr } from "../../i18n";
import { AlbumLookupError } from "./album-search-errors";

export interface AlbumEdition {
  pluginId: string;
  details: ScrapeCandidate;
  tracks: ScrapeCandidate;
  country?: string;
}

// 预览令牌在服务端最多保留半小时。浏览器从首次查询开始计时，留出选用时间。
const lifetime = 20 * 60_000;
const limit = 8;

export class AlbumPreviews {
  private entries = new Map<string, { expires: number; edition: AlbumEdition }>();
  constructor(private api: ScrapersApi) {}

  async read(pluginId: string, query: ScraperQuery, signal: AbortSignal,
    options: { refresh?: boolean; summary?: { item: ScrapeCandidate; requestedAt: number } } = {}): Promise<AlbumEdition> {
    const now = Date.now();
    const key = (id?: string, url?: string) => JSON.stringify([pluginId, id, url, query.country]);
    const cached = this.entries.get(key(query.externalId, query.sourceUrl));
    if (!options.refresh && cached && cached.expires > now) return cached.edition;

    const summary = !options.refresh && options.summary && options.summary.requestedAt + lifetime > now ? options.summary : undefined;
    const details = summary ? [summary.item] : await this.api.search(pluginId, "albumDetails", query, signal, options.refresh);
    signal.throwIfAborted();
    if (details.length !== 1 || query.externalId && details[0].id !== query.externalId) {
      for (const [entryKey, { edition }] of this.entries) {
        if (edition.pluginId === pluginId && edition.country === query.country &&
          (edition.details.id === query.externalId || edition.details.sourceUrl === query.sourceUrl && !!query.sourceUrl))
          this.entries.delete(entryKey);
      }
      throw new AlbumLookupError(tr("未找到关联页面对应的唯一专辑，请检查平台页面。"));
    }
    const item = details[0];
    const lookup = { ...query, externalId: item.id, sourceUrl: item.sourceUrl || query.sourceUrl };
    const candidates = await this.api.search(pluginId, "albumTracks", lookup, signal, options.refresh);
    signal.throwIfAborted();
    const tracks = candidates.find(candidate => candidate.id === item.id && candidate.tracks?.length);
    if (!tracks) {
      this.entries.delete(key(item.id, lookup.sourceUrl));
      throw new AlbumLookupError(tr("未能读取这张专辑的完整曲目，请重试或更换资料来源。"));
    }
    const edition = { pluginId, details: item, tracks, country: query.country };
    const cacheKey = key(item.id, lookup.sourceUrl);
    this.entries.delete(cacheKey);
    if (this.entries.size >= limit) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(cacheKey, { edition, expires: (summary?.requestedAt ?? now) + lifetime });
    return edition;
  }
}
