import { ApiError, errorMessage, randomRequestId } from "../api/client";
import { TasksApi, taskActive, taskSnapshot, type RefreshTask, type TaskScope } from "../api/tasks";
import { Store } from "../app/store";

interface TaskQueueSnapshot {
  scope: TaskScope;
  items: RefreshTask[];
  activeCount: number;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  cancelling: string[];
  cancelErrors: Record<string, string>;
}
const initial = (): TaskQueueSnapshot => ({ scope: "mine", items: [], activeCount: 0, nextCursor: null,
  loading: false, error: null, cancelling: [], cancelErrors: {} });

export class TaskQueueState extends Store<TaskQueueSnapshot> {
  private enabled = false;
  private admin = false;
  private connected = false;
  private pages = 1;
  private subscription: { id: string; controller: AbortController } | null = null;
  private history: { controller: AbortController; changes: Map<string, RefreshTask> } | null = null;
  private cancellations = new Map<string, AbortController>();
  private active = new Set<string>();
  constructor(private api: TasksApi, private finished: (task: RefreshTask) => void = () => {}) { super(initial()); }
  start(admin: boolean): void {
    this.clear(); this.enabled = true; this.admin = admin;
    this.set({ ...initial(), loading: true });
  }
  clear(): void {
    this.enabled = false; this.connected = false; this.stopReads();
    this.cancellations.forEach(controller => controller.abort()); this.cancellations.clear();
    this.active.clear(); this.pages = 1; this.set(initial());
  }
  private stopReads(): void {
    this.subscription?.controller.abort(); this.subscription = null;
    this.history?.controller.abort(); this.history = null;
  }
  connection(online: boolean): void {
    if (!this.enabled) return;
    if (online && this.connected && this.subscription) return;
    this.connected = online;
    if (online) void this.refresh();
    else {
      this.stopReads();
      this.set({ ...this.value, loading: false, error: errorMessage(new ApiError("NETWORK_ERROR", "Control connection closed")) });
    }
  }
  setScope(scope: TaskScope): void {
    if (!this.enabled || scope === this.value.scope || scope === "all" && !this.admin) return;
    this.stopReads(); this.active.clear();
    this.cancellations.forEach(controller => controller.abort()); this.cancellations.clear();
    const error = this.connected ? null : this.value.error;
    this.pages = 1; this.set({ ...initial(), scope, error }); void this.refresh();
  }
  async more(): Promise<void> {
    if (!this.connected || !this.value.nextCursor || this.value.loading) return;
    ++this.pages;
    await this.readHistory(this.value.nextCursor, 1);
  }
  async refresh(): Promise<void> {
    if (!this.enabled || !this.connected) return;
    this.stopReads();
    const subscription = { id: randomRequestId(), controller: new AbortController() };
    this.subscription = subscription;
    this.set({ ...this.value, loading: true, error: null });
    try {
      await this.api.subscribe(subscription.id, this.value.scope, subscription.controller.signal);
    } catch (error) {
      if (subscription === this.subscription) {
        this.subscription = null;
        this.set({ ...this.value, loading: false, error: errorMessage(error) });
      }
    }
  }
  receive(data: unknown): void {
    if (!this.subscription) return;
    try {
      const snapshot = taskSnapshot(data, this.subscription.id);
      if (!snapshot) return;
      const { page, changed, reset } = snapshot;
      if (reset || !page.nextCursor) {
        this.history?.controller.abort(); this.history = null;
        if (!page.nextCursor) this.pages = 1;
      }
      const expanded = !reset && this.pages > 1;
      const updates = [...changed, ...page.items];
      if (this.history) for (const task of updates) this.history.changes.set(task.id, task);
      const items = expanded ? mergeWindow(this.value.items, updates) : page.items;
      this.set({ ...this.value, items, activeCount: page.activeCount, nextCursor: expanded ? this.value.nextCursor : page.nextCursor,
        error: null, loading: this.history !== null });
      this.track(items, changed);
      if (reset && this.pages > 1 && page.nextCursor) void this.readHistory(page.nextCursor, this.pages - 1);
    } catch (error) {
      this.set({ ...this.value, loading: false, error: errorMessage(error) });
    }
  }
  private track(items: RefreshTask[], changed: RefreshTask[] = []): void {
    for (const task of items) if (taskActive(task)) this.active.add(task.id);
    for (const task of [...items, ...changed])
      if (!taskActive(task) && this.active.delete(task.id)) this.finished(task);
  }
  private async readHistory(cursor: string, count: number): Promise<void> {
    const read = { controller: new AbortController(), changes: new Map<string, RefreshTask>() };
    this.history = read;
    const seen = new Set<string>();
    let loaded = this.pages - count;
    this.set({ ...this.value, loading: true });
    try {
      for (let index = 0; index < count; ++index) {
        seen.add(cursor);
        const page = await this.api.list(this.value.scope, cursor, read.controller.signal);
        if (this.history !== read) return;
        if (page.nextCursor && seen.has(page.nextCursor)) throw new ApiError("INVALID_RESPONSE", "Repeated task page cursor");
        // 较晚抵达的历史响应可能早于当前推送。保留期间收到的任务状态及首屏活动总数。
        const items = mergeWindow([...this.value.items, ...page.items], read.changes.values());
        ++loaded;
        this.set({ ...this.value, items, nextCursor: page.nextCursor, error: null });
        this.track(items);
        if (!page.nextCursor) { this.pages = loaded; break; }
        cursor = page.nextCursor;
      }
    } catch (error) {
      if (this.history === read) {
        this.pages = loaded;
        this.set({ ...this.value, error: errorMessage(error) });
      }
    } finally {
      if (this.history === read) {
        this.history = null;
        this.set({ ...this.value, loading: false });
      }
    }
  }
  async cancel(id: string): Promise<void> {
    if (!this.enabled || this.cancellations.has(id)) return;
    const controller = new AbortController(); this.cancellations.set(id, controller);
    const scope = this.value.scope;
    this.set({ ...this.value, cancelling: [...this.value.cancelling, id], cancelErrors: { ...this.value.cancelErrors, [id]: "" } });
    try {
      // 响应只确认取消请求。由同一订阅推送行与角标，避免迟到的响应覆盖终态。
      await this.api.cancel(id, scope, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted)
        this.set({ ...this.value, cancelErrors: { ...this.value.cancelErrors, [id]: errorMessage(error) } });
    } finally {
      if (!controller.signal.aborted) {
        this.cancellations.delete(id);
        this.set({ ...this.value, cancelling: this.value.cancelling.filter(item => item !== id) });
      }
    }
  }
}

/** 服务端按 UTC 创建时间、任务 ID 倒序排列。保留当前游标之前新增或变更的行。 */
function mergeWindow(rows: RefreshTask[], updates: Iterable<RefreshTask>): RefreshTask[] {
  const ordered = (a: RefreshTask, b: RefreshTask) => {
    const left = a.createdAt.replace(/Z$/, ""), right = b.createdAt.replace(/Z$/, "");
    if (left !== right) return left > right ? -1 : 1;
    return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
  };
  const byId = new Map<string, RefreshTask>();
  for (const task of rows) if (!byId.has(task.id)) byId.set(task.id, task);
  const last = rows.at(-1);
  for (const task of updates) if (!last || byId.has(task.id) || ordered(task, last) <= 0) byId.set(task.id, task);
  return Array.from(byId.values()).sort(ordered);
}
