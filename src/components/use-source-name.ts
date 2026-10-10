import { useServices, useStore } from "../app/services";
import { useLocale } from "../i18n";
import { sourceName, type SourceLabel } from "./source-name";
import { musicSources } from "./music-sources";

export function useSourceName(): (source: SourceLabel) => string {
  const s = useServices();
  const online = useStore(s.content.onlineInstances);
  const providers = useStore(s.libraryApi.providerInstances);
  const { locale } = useLocale();
  return (source) => sourceName(source, [...online, ...providers], locale);
}

export function useMusicSources() {
  const s = useServices();
  return musicSources(useStore(s.libraryApi.providerInstances), useStore(s.content.onlineInstances));
}
