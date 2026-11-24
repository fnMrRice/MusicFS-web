import { isDownloadSummary, type DownloadSummary } from "../api/online-downloads";

type Listener = (job?: DownloadSummary) => void;

export class DownloadEvents {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(id: string, listener: Listener): () => void {
    let group = this.listeners.get(id);
    if (!group) this.listeners.set(id, group = new Set());
    group.add(listener);
    return () => {
      group.delete(listener);
      if (!group.size) this.listeners.delete(id);
    };
  }

  ready(): void {
    this.listeners.forEach(group => group.forEach(listener => listener()));
  }

  receive(data: unknown): void {
    if (!data || typeof data !== "object" || !("jobs" in data) || !Array.isArray(data.jobs) ||
        !("invalidated" in data) || !Array.isArray(data.invalidated)) return;
    for (const job of data.jobs) {
      if (isDownloadSummary(job)) this.listeners.get(job.jobId)?.forEach(listener => listener(job));
    }
    for (const id of data.invalidated) {
      if (typeof id === "string") this.listeners.get(id)?.forEach(listener => listener());
    }
  }
}
