const resources = ["scans", "pluginJobs", "playlistSync"] as const;
type ActivityTopic = typeof resources[number] | "configuration";

/** 按资源通知订阅方重新读取当前会话有权查看的数据。 */
export class ActivityEvents {
  private listeners = new Map<ActivityTopic, Set<() => void>>();

  subscribe(topic: ActivityTopic, listener: () => void): () => void {
    let subscribers = this.listeners.get(topic);
    if (!subscribers) this.listeners.set(topic, subscribers = new Set());
    subscribers.add(listener);
    return () => { subscribers.delete(listener); };
  }

  /** 先订阅再读取快照；读取期间到达的多条通知只补读一次。 */
  watch(topic: ActivityTopic, read: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    let reading = false, invalidated = false;
    const refresh = async () => {
      if (controller.signal.aborted) return;
      if (reading) { invalidated = true; return; }
      reading = true;
      try {
        do {
          invalidated = false;
          await read(controller.signal);
        } while (invalidated && !controller.signal.aborted);
      } finally {
        reading = false;
      }
    };
    const unsubscribe = this.subscribe(topic, refresh);
    void refresh();
    return { refresh, stop: () => { unsubscribe(); controller.abort(); } };
  }

  invalidate(topic: ActivityTopic): void {
    this.listeners.get(topic)?.forEach(listener => listener());
  }

  ready(): void {
    this.listeners.forEach((_listeners, topic) => this.invalidate(topic));
  }

  receive(data: unknown): void {
    if (!data || typeof data !== "object" || !("resources" in data) || !Array.isArray(data.resources)) return;
    for (const topic of resources) if (data.resources.includes(topic)) this.invalidate(topic);
  }
}
