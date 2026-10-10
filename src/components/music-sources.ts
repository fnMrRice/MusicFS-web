import type { OnlineInstance } from "../api/content";
import type { PluginIdentity, Provider } from "../api/types";

export interface MusicSource {
  id: string;
  provider?: Provider;
  online?: OnlineInstance;
}

// Missing metadata is supported for older servers and unavailable plugins.
const isMusicSource = (source: { plugin?: PluginIdentity }) =>
  !source.plugin || source.plugin.features?.includes("music-source");

export function musicSources(providers: readonly Provider[], online: readonly OnlineInstance[]): MusicSource[] {
  const sources = new Map<string, MusicSource>();
  for (const provider of providers)
    if (isMusicSource(provider)) sources.set(provider.id, { id: provider.id, provider });
  for (const instance of online)
    if (isMusicSource(instance)) sources.set(instance.instanceId, { id: instance.instanceId, online: instance });
  return [...sources.values()];
}
