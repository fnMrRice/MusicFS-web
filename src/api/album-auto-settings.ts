import { ApiClient, ApiError } from "./client";

export interface AlbumAutoSettings {
  revision: number;
  localPluginOrder: string[];
}

const path = "/scrapers/album-auto-settings";

export async function albumAutoSettings(client: ApiClient, signal: AbortSignal,
  update?: { settings: AlbumAutoSettings; key: string }): Promise<AlbumAutoSettings> {
  const data = await client.request<AlbumAutoSettings>(path, update ? {
    method: "PUT", signal, idempotencyKey: update.key,
    body: { expectedRevision: update.settings.revision, localPluginOrder: update.settings.localPluginOrder },
  } : { signal });
  if (!data || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.localPluginOrder) ||
    !data.localPluginOrder.length || data.localPluginOrder.some(id => typeof id !== "string" || !id.trim()) ||
    new Set(data.localPluginOrder).size !== data.localPluginOrder.length) {
    throw new ApiError("INVALID_RESPONSE", "Invalid album scraper preferences");
  }
  return data;
}
