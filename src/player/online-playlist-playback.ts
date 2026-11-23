import { ApiClient, ApiError, errorMessage } from "../api/client";
import type { Observation, OnlineInstance } from "../api/content";
import { resolveOnlineAudio } from "../api/online-audio";
import { withRateLimitRetry } from "../api/rate-limit";
import type { SourceTrack } from "../api/types";
import { Store } from "../app/store";
import type { PlaybackQueue } from "./playback-queue";

interface Preparation {
  key: string;
  busy: boolean;
  error: string | null;
}

export function supportsOnlinePlayback(source: OnlineInstance) {
  return source.availability === "available" &&
    source.capabilities.some(capability => capability.name === "stream.resolve" && capability.supported);
}

export class OnlinePlaylistPlayback extends Store<Preparation> {
  private active: { controller: AbortController; source: OnlineInstance; started: boolean } | null = null;

  constructor(
    private client: ApiClient,
    private queue: PlaybackQueue,
    private addTracks: (items: SourceTrack[], start: boolean) => void,
  ) {
    super({ key: "", busy: false, error: null });
  }

  cancel() {
    this.active?.controller.abort();
    this.active = null;
    this.set({ key: "", busy: false, error: null });
  }

  leave(key: string) {
    // 已开始的歌单属于播放器，切换页面后仍继续准备后续曲目。
    if (this.value.key === key && this.active && !this.active.started) this.cancel();
  }

  updateSources(sources: OnlineInstance[]) {
    if (!this.active) return;
    const { source } = this.active;
    const current = sources.find(item => item.instanceId === source.instanceId);
    if (!current || current.accountId !== source.accountId || current.accountRevision !== source.accountRevision ||
        !supportsOnlinePlayback(current)) this.cancel();
  }

  async start(key: string, source: OnlineInstance, entries: Observation["entries"]) {
    if (this.active && this.value.key === key) return;
    this.cancel();
    const request = new AbortController();
    const job = { controller: request, source, started: false };
    this.active = job;
    this.set({ key, busy: true, error: null });
    // 哔哩哔哩收藏夹的失效占位没有对应的可播放曲目。
    const ids = [...entries].sort((a, b) => a.position - b.position).map(entry => entry.externalTrackId)
      .filter(id => source.platform !== "bilibili" || !id.startsWith("unavailable:"));
    const cache = new Map<string, Promise<SourceTrack | null>>();
    const resolve = (id: string) => {
      let promise = cache.get(id);
      if (!promise) {
        promise = withRateLimitRetry(() => resolveOnlineAudio(this.client, source.instanceId, id, request.signal), request.signal)
          .catch(error => {
            if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
            throw error;
          });
        cache.set(id, promise);
      }
      return promise;
    };

    const originalQueue = this.queue.value;
    let firstTrack: SourceTrack | undefined;
    let error: string | null = null;
    try {
      for (let offset = 0; offset < ids.length;) {
        // 第一首可用曲目就绪即开播，之后小批并发建档，按原顺序保留重复曲目。
        const batch = ids.slice(offset, offset + (job.started ? 3 : 1));
        const resolved = await Promise.all(batch.map(resolve));
        const current = this.queue.value;
        // 普通入队、插播和乱序仍保留本次歌单；换队列或撤销切歌后不再追加。
        if (request.signal.aborted || (firstTrack ? !current.items.includes(firstTrack)
          : current.items !== originalQueue.items || current.index !== originalQueue.index)) return;
        const playable = resolved.filter(track => track !== null);
        if (playable.length) {
          this.addTracks(playable, !job.started);
          firstTrack ??= playable[0];
          job.started = true;
        }
        offset += batch.length;
      }
      if (!job.started) error = "暂无可播放曲目";
    } catch (cause) {
      if (!request.signal.aborted) error = errorMessage(cause);
    } finally {
      request.abort();
      if (this.active === job) {
        this.active = null;
        this.set({ key, busy: false, error });
      }
    }
  }
}
