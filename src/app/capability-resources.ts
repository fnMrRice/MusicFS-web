const affectedResources = new Set([
  "providers",
  "settings-providers",
  "search-instances",
  "import-providers",
]);

/** Invalidates only capability-bearing reads, never playback or paged results. */
export class CapabilityResources {
  private revision = 0;
  private listeners = new Set<() => void>();
  snapshot = (key: string): number =>
    affectedResources.has(key) ? this.revision : 0;
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
