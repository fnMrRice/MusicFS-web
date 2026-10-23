import { errorMessage } from "../api/client";
import type { DirectoriesApi, RootStatistic } from "../api/directories";
import { Store } from "../app/store";

interface RootStatisticsSnapshot { data: RootStatistic[] | null; loading: boolean; error: string | null }

/** 每个来源和登录会话独立持有统计，刷新时保留最近成功结果。 */
export class RootStatisticsState extends Store<RootStatisticsSnapshot> {
  private controller: AbortController | null = null;
  constructor(private api: Pick<DirectoriesApi, "rootStatistics">) {
    super({ data: null, loading: true, error: null });
  }
  detach(): void { this.controller?.abort(); }
  async refresh(): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.set({ ...this.value, loading: true, error: null });
    try {
      const data = await this.api.rootStatistics(controller.signal);
      if (!controller.signal.aborted) this.set({ data, loading: false, error: null });
    } catch (error) {
      if (!controller.signal.aborted) this.set({ ...this.value, loading: false, error: errorMessage(error) });
    }
  }
}

export function directorySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
}
