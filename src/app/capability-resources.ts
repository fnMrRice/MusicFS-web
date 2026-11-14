const affectedResources = new Set([
  "work-content-types",
  "providers",
  "settings-providers",
  "settings-plugins",
  "settings-plugins-false",
  "settings-plugins-true",
  "settings-local-directories-true",
  "search-instances",
  "import-providers",
  "platform-account-instances",
  "source-playlist-providers",
  "source-playlist-instances",
]);

/** Invalidates only capability-bearing reads, never playback or paged results. */
export class CapabilityResources {
  private revision = 0;
  private listeners = new Set<() => void>();
  snapshot = (key: string): number =>
    affectedResources.has(key) || key.startsWith("settings-local-directories:") ? this.revision : 0;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  invalidate = (): void => {
    ++this.revision;
    this.listeners.forEach((listener) => listener());
  };
}

export const capabilityResources = new CapabilityResources();
