export interface CapabilityEventSource {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  close(): void;
}

/** One authenticated stream belongs to Services, outside React's effect replay. */
export class CapabilityEvents {
  private source: CapabilityEventSource | null = null;
  private identity = "";
  private cleanup: (() => void) | null = null;
  private checking: AbortController | null = null;

  constructor(
    private invalidate: () => void,
    private checkSession: (signal: AbortSignal) => Promise<unknown>,
    private create: (url: string) => CapabilityEventSource = (url) =>
      new EventSource(url),
  ) {}

  start(identity: string): void {
    if (this.source && identity === this.identity) return;
    this.stop();
    this.identity = identity;
    let source: CapabilityEventSource;
    try {
      source = this.create("/api/v1/events");
    } catch {
      // Capability reads remain available through explicit refresh.
      return;
    }
    this.source = source;
    let previous: string | null = null;
    const opened: EventListener = () => {
      if (this.source === source) previous = null;
    };
    const changed: EventListener = (event) => {
      if (this.source !== source) return;
      const data: unknown = (event as MessageEvent<unknown>).data;
      if (typeof data !== "string" || data.length > 4096) return;
      try {
        const value: unknown = JSON.parse(data);
        if (!value || typeof value !== "object") return;
        const { revision, sequence } = value as Record<string, unknown>;
        if (
          typeof revision !== "string" || revision.length > 256 ||
          typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0
        ) return;
        const current = JSON.stringify([revision, sequence]);
        if (current === previous) return;
        previous = current;
        // Server sends this event immediately after every (re)connection.
        this.invalidate();
      } catch {
        // Invalid events cannot authorize a capability or inject UI state.
      }
    };
    const failed: EventListener = () => {
      if (this.source !== source || this.checking) return;
      const check = new AbortController();
      this.checking = check;
      // EventSource hides HTTP status. A bounded authenticated read handles 401
      // through ApiClient; network failures leave native SSE retry in control.
      void this.checkSession(check.signal).catch(() => {}).finally(() => {
        if (this.checking === check) this.checking = null;
      });
    };
    source.addEventListener("open", opened);
    source.addEventListener("capabilities.changed", changed);
    source.addEventListener("error", failed);
    this.cleanup = () => {
      source.removeEventListener("open", opened);
      source.removeEventListener("capabilities.changed", changed);
      source.removeEventListener("error", failed);
    };
  }

  stop(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.source?.close();
    this.source = null;
    this.identity = "";
    this.checking?.abort();
    this.checking = null;
  }
}
