import type { SourceTrack } from "../api/types";
import { Store } from "../app/store";

export type PlaybackMode = "sequence" | "repeat-one" | "repeat-all" | "shuffle";
export interface PlaybackQueueState {
  items: SourceTrack[];
  index: number;
  mode: PlaybackMode;
}
interface Selection {
  items: SourceTrack[];
  index: number;
  history: number[];
  future: number[];
  priority: number[];
}
export interface PlaybackQueueSnapshot extends PlaybackQueueState {
  history: number[];
  future: number[];
  priority: number[];
}

export class PlaybackQueue extends Store<PlaybackQueueState> {
  private history: number[] = [];
  private future: number[] = [];
  private priority: number[] = [];
  private settled: Selection | null = null;
  private pending = false;
  private pendingRecorded = false;

  constructor(private random: () => number = Math.random) {
    super({ items: [], index: -1, mode: "sequence" });
  }

  snapshot(): PlaybackQueueSnapshot {
    const history = [...this.history], future = [...this.future];
    // 刷新只恢复导航状态，不恢复尚未完成的淡出切歌事务。
    while (history.at(-1) === this.value.index) history.pop();
    while (future.at(-1) === this.value.index) future.pop();
    return { ...this.value, history, future, priority: [...this.priority] };
  }

  restore(snapshot: PlaybackQueueSnapshot): void {
    this.forgetSelection();
    this.history = snapshot.history;
    this.future = snapshot.future;
    this.priority = snapshot.priority;
    this.set({ items: snapshot.items, index: snapshot.index, mode: snapshot.mode });
  }

  commitSelection(): void {
    const { items, index } = this.value;
    // 连续切歌可能绕回当前条目，未开始播放的中间选择不应进入历史。
    while (this.history.at(-1) === index) this.history = this.history.slice(0, -1);
    while (this.future.at(-1) === index) this.future = this.future.slice(0, -1);
    this.pending = false;
    this.pendingRecorded = false;
    this.settled = { items, index, history: this.history, future: this.future, priority: this.priority };
  }

  rollbackSelection(): void {
    if (!this.settled) return;
    const { items, index, history, future, priority } = this.settled;
    this.history = history;
    this.future = future;
    this.priority = priority;
    this.pending = false;
    this.pendingRecorded = false;
    this.set({ ...this.value, items, index });
  }

  clear(): void {
    this.forgetSelection();
    this.set({ items: [], index: -1, mode: "sequence" });
  }

  forgetSelection(): void {
    this.settled = null;
    this.history = [];
    this.future = [];
    this.priority = [];
    this.pending = false;
    this.pendingRecorded = false;
  }

  setMode(mode: PlaybackMode): void {
    if (this.value.mode === mode) return;
    this.history = [];
    this.future = [];
    this.pendingRecorded = false;
    if (this.settled) this.settled = { ...this.settled, history: [], future: [] };
    this.set({ ...this.value, mode });
  }

  replace(track: SourceTrack, items?: SourceTrack[]): void {
    const candidates = items?.filter((item) => item.availability === "available") ?? [track];
    // 优先匹配队列项本身，避免相同来源曲目的多个条目总是选中第一项。
    const exact = candidates.indexOf(track);
    const index = exact >= 0 ? exact : candidates.findIndex((item) => item.sourceTrackId === track.sourceTrackId);
    this.history = [];
    this.future = [];
    this.priority = [];
    this.pending = true;
    this.pendingRecorded = false;
    this.set({ ...this.value, items: candidates, index });
  }

  enqueue(tracks: SourceTrack[]): void {
    const previous = this.value;
    const items = [...previous.items, ...tracks.filter((item) => item.availability === "available")];
    if (this.settled?.items === previous.items) this.settled = { ...this.settled, items };
    this.set({ ...previous, items });
  }

  playNext(tracks: SourceTrack[]): void {
    const additions = tracks.filter((item) => item.availability === "available");
    if (!additions.length) return;
    const previous = this.value;
    const position = previous.index + 1;
    const items = [...previous.items.slice(0, position), ...additions, ...previous.items.slice(position)];
    const relocate = (index: number) => index >= position ? index + additions.length : index;
    const priority = additions.map((_, index) => position + index);
    this.history = this.history.map(relocate);
    this.future = this.future.map(relocate);
    this.priority = [...priority, ...this.priority.map(relocate)];
    // 插入是独立的队列编辑；取消淡出切歌时仍保留它，并恢复实际播放条目的位置。
    if (this.settled?.items === previous.items) {
      this.settled = {
        items, index: relocate(this.settled.index),
        history: this.settled.history.map(relocate), future: this.settled.future.map(relocate),
        priority: [...priority, ...this.settled.priority.map(relocate)],
      };
    }
    this.set({ ...previous, items, index: relocate(previous.index) });
  }

  select(index: number): SourceTrack | null {
    if (!Number.isInteger(index) || !this.value.items[index]) return null;
    if ((!this.pending || this.pendingRecorded) && this.value.mode === "shuffle" && this.value.index >= 0 && this.value.index !== index) {
      this.history = [...this.history, this.value.index];
    }
    this.future = [];
    this.priority = this.priority.filter((entry) => entry !== index);
    this.pending = true;
    this.pendingRecorded = false;
    this.set({ ...this.value, index });
    return this.value.items[index];
  }

  canAdvance(direction: number): boolean {
    const { items, index, mode } = this.value;
    if (!items.length || !Number.isFinite(direction) || !direction) return false;
    if (index < 0) return direction > 0;
    if (direction > 0 && this.priority.length) return true;
    if (mode === "shuffle") return direction < 0 ? this.history.length > 0 : items.length > 1;
    if (mode === "repeat-all") return true;
    return direction < 0 ? index > 0 : index < items.length - 1;
  }

  advance(direction: number, ended = false): SourceTrack | null {
    const { items, index, mode } = this.value;
    if (ended && index >= 0 && !this.priority.length && (mode === "repeat-one" || (mode === "shuffle" && items.length === 1))) {
      this.pending = true;
      this.pendingRecorded = false;
      return items[index] ?? null;
    }
    if (!this.canAdvance(direction)) return null;
    let target = index + Math.sign(direction);
    let recorded = false;
    if (direction > 0 && this.priority.length) {
      target = this.priority[0];
      this.priority = this.priority.slice(1);
      if (mode === "shuffle" && (!this.pending || this.pendingRecorded) && index >= 0) {
        this.history = [...this.history, index];
      }
    } else if (mode === "shuffle") {
      if (direction < 0) {
        target = this.history[this.history.length - 1];
        this.history = this.history.slice(0, -1);
        if (!this.pending || this.pendingRecorded) this.future = [...this.future, index];
        recorded = true;
      } else {
        recorded = this.future.length > 0;
        target = this.future[this.future.length - 1] ?? this.randomIndex();
        this.future = this.future.slice(0, -1);
        if ((!this.pending || this.pendingRecorded) && index >= 0) this.history = [...this.history, index];
      }
    } else if (mode === "repeat-all") target = (target + items.length) % items.length;
    this.pending = true;
    this.pendingRecorded = recorded;
    this.set({ ...this.value, index: target });
    return items[target];
  }

  shuffle(): void {
    const previous = this.value;
    if (previous.items.length < 2) return;
    const order = previous.items.map((_, index) => index);
    for (let i = order.length - 1; i > 0; --i) {
      const j = Math.floor(this.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const items = order.map((index) => previous.items[index]);
    const positions = new Map(order.map((old, current) => [old, current]));
    const relocate = (index: number) => positions.get(index) ?? -1;
    this.history = this.history.map(relocate);
    this.future = this.future.map(relocate);
    this.priority = this.priority.map(relocate);
    if (this.settled?.items === previous.items) {
      this.settled = {
        items, index: relocate(this.settled.index),
        history: this.settled.history.map(relocate), future: this.settled.future.map(relocate),
        priority: this.settled.priority.map(relocate),
      };
    }
    this.set({ ...previous, items, index: relocate(previous.index) });
  }

  private randomIndex(): number {
    const { items, index } = this.value;
    let candidates = items.map((_, i) => i).filter((i) => items[i].sourceTrackId !== items[index]?.sourceTrackId);
    if (!candidates.length) candidates = items.map((_, i) => i).filter((i) => i !== index);
    return candidates[Math.floor(this.random() * candidates.length)];
  }
}
