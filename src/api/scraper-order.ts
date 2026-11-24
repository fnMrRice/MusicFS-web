import { ApiClient, ApiError } from "./client";

export interface ScraperOrder {
  revision: number;
  order: string[];
}

export type ScraperOrderKind = "album" | "lyrics";
export const localLyricsId = "musicfs.scraper.local";

export async function scraperOrder(client: ApiClient, kind: ScraperOrderKind, signal: AbortSignal,
  update?: { settings: ScraperOrder; key: string }): Promise<ScraperOrder> {
  const field = kind === "lyrics" ? "pluginOrder" : "localPluginOrder";
  const data = await client.request<{ revision: number } & Record<typeof field, unknown>>(`/scrapers/${kind}-auto-settings`, update ? {
    method: "PUT", signal, idempotencyKey: update.key,
    body: { expectedRevision: update.settings.revision, [field]: update.settings.order },
  } : { signal });
  const order = data?.[field];
  if (!data || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(order) ||
    (kind === "album" && !order.length) || order.some(id => typeof id !== "string" || !id.trim()) ||
    new Set(order).size !== order.length) {
    throw new ApiError("INVALID_RESPONSE", "Invalid scraper order");
  }
  return { revision: data.revision, order };
}
