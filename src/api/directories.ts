import { ApiClient } from "./client";
import type { PluginIdentity } from "./types";

export interface MusicRoot { id: string; name: string; path?: string; importDefaults?: ImportDefaults }
export interface ImportDefaults {
  recursive: boolean;
  maxDepth: number;
  importLyrics: boolean;
  excludePatterns: string[];
  skipHidden: boolean;
  respectNoMedia: boolean;
}
export interface DirectoryItem { name: string; path: string; available: boolean; configuredRootId: string | null }
export interface DirectoryPage {
  revision: string;
  path: string | null;
  parentPath: string | null;
  configuredRootId: string | null;
  items: DirectoryItem[];
  nextCursor: string | null;
}
export interface LocalConfiguration {
  revision: string;
  roots: { id: string; name: string; pathConfigured: boolean; importDefaults?: ImportDefaults }[];
  rootImportDefaultsSupported?: boolean;
  importOptions?: { importDefaults: ImportDefaults; schemaRevision: string };
}
export interface PluginOperation {
  operationId: string;
  status: "applying" | "draining" | "succeeded" | "failed" | "superseded";
  errorCode: string | null;
}
export interface ManagedInstance {
  instanceId: string;
  name: string;
  runtimeState: string;
  reason: string | null;
  ownerUserId?: string;
  accountName?: string;
}
export interface PluginDisplayCount {
  value: number;
  unit: string;
  localizedUnits: Record<string, string>;
}
export interface PluginStorage {
  backend: string;
  mode: "builtin" | "process";
  runtimeState: "ready" | "unavailable" | "unknown";
}
export interface PluginDSP {
  configured: boolean;
  chainState: "not_configured" | "not_in_chain" | "in_chain";
  nodes: {
    position: number;
    name: string;
    version: number;
    params: Record<string, number>;
    mode: "builtin" | "process";
  }[];
}
export interface ManagedPlugin {
  pluginId: string;
  plugin: PluginIdentity;
  version: string;
  displayCount?: PluginDisplayCount;
  supportsMultipleInstances: boolean;
  instances: ManagedInstance[];
  required?: boolean;
  stateMutable?: boolean;
  storage?: PluginStorage;
  dsp?: PluginDSP;
}
export interface PluginSnapshot {
  restartRequired?: boolean;
  items: ManagedPlugin[];
}

export class DirectoriesApi {
  constructor(private client: ApiClient, private instanceId: string) {}
  private get path() {
    return `/admin/plugin-instances/${encodeURIComponent(this.instanceId)}`;
  }
  configuration(signal?: AbortSignal) {
    return this.client.request<LocalConfiguration>(`${this.path}/configuration`, { signal });
  }
  browse(path: string | null, cursor: string | null, signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (path !== null) query.set("path", path);
    if (cursor !== null) query.set("cursor", cursor);
    return this.client.request<DirectoryPage>(`${this.path}/directories?${query}`, { signal });
  }
  save(musicRoots: MusicRoot[], importDefaults: ImportDefaults, revision: string, key: string, signal?: AbortSignal) {
    return this.client.request<PluginOperation>(`${this.path}/configuration`, {
      method: "PUT", body: { musicRoots, importDefaults }, ifMatch: revision, idempotencyKey: key, signal,
    });
  }
  operation(id: string, signal?: AbortSignal) {
    return this.client.request<PluginOperation>(`/admin/plugin-operations/${encodeURIComponent(id)}`, { signal });
  }
}
