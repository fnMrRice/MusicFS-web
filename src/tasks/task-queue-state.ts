import { ApiError, errorMessage } from "../api/client";
import { TasksApi, taskActive, type RefreshTask, type TaskScope } from "../api/tasks";
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
  private generation = 0;
  private pages = 1;
  private request: AbortController | null = null;
  private cancellations = new Map<string, AbortController>();
  private invalidated = false;
  constructor(private api: TasksApi, private finished: (task: RefreshTask) => void = () => {}) { super(initial()); }
  start(admin: boolean): void {
    this.clear(); this.enabled = true; this.admin = admin;
    void this.refresh();
  }
  clear(): void {
    this.enabled = false; ++this.generation; this.request?.abort(); this.request = null;
    this.cancellations.forEach(controller => controller.abort()); this.cancellations.clear();
    this.invalidated = false; this.pages = 1; this.set(initial());
  }
  setScope(scope: TaskScope): void {
    if (!this.enabled || scope === this.value.scope || scope === "all" && !this.admin) return;
    ++this.generation; this.request?.abort(); this.request = null;
    this.cancellations.forEach(controller => controller.abort()); this.cancellations.clear();
    this.pages = 1; this.set({ ...initial(), scope }); void this.refresh();
  }
  async more(): Promise<void> {
    if (!this.value.nextCursor || this.value.loading) return;
    ++this.pages; await this.refresh();
  }
  invalidate(): void {
    if (this.request) this.invalidated = true;
    else void this.refresh();
  }
  async refresh(): Promise<void> {
    if (!this.enabled) return;
    this.request?.abort();
    this.invalidated = false;
    const controller = new AbortController(); this.request = controller;
    const generation = this.generation, scope = this.value.scope;
    const current = () => this.enabled && generation === this.generation && this.request === controller && !controller.signal.aborted;
    this.set({ ...this.value, loading: true });
    try {
      const items: RefreshTask[] = [], ids = new Set<string>(), cursors = new Set<string>();
      let cursor: string | null = null, activeCount = 0;
      for (let index = 0; index < this.pages; ++index) {
        const page = await this.api.list(scope, cursor, controller.signal);
        if (!current()) return;
        if (index === 0) activeCount = page.activeCount;
        for (const task of page.items) if (!ids.has(task.id)) { ids.add(task.id); items.push(task); }
        cursor = page.nextCursor;
        if (!cursor) break;
        if (cursors.has(cursor)) throw new ApiError("INVALID_RESPONSE", "Repeated task page cursor");
        cursors.add(cursor);
      }
      const previous = new Map(this.value.items.map(task => [task.id, task]));
      this.set({ ...this.value, items, nextCursor: cursor, activeCount, loading: false, error: null });
      for (const task of items) if (!taskActive(task) && previous.has(task.id) && taskActive(previous.get(task.id)!)) this.finished(task);
    } catch (error) {
      if (current()) this.set({ ...this.value, loading: false, error: errorMessage(error) });
    } finally {
      if (current()) {
        this.request = null;
        if (this.invalidated) void this.refresh();
      }
    }
  }
  async cancel(id: string): Promise<void> {
    if (!this.enabled || this.cancellations.has(id)) return;
    const controller = new AbortController(); this.cancellations.set(id, controller);
    const generation = this.generation, scope = this.value.scope;
    this.set({ ...this.value, cancelling: [...this.value.cancelling, id], cancelErrors: { ...this.value.cancelErrors, [id]: "" } });
    try {
      const task = await this.api.cancel(id, scope, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      const previous = this.value.items.find(item => item.id === id);
      this.set({ ...this.value, items: this.value.items.map(item => item.id === id ? task : item) });
      if (previous && taskActive(previous) && !taskActive(task)) this.finished(task);
      void this.refresh();
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted)
        this.set({ ...this.value, cancelErrors: { ...this.value.cancelErrors, [id]: errorMessage(error) } });
    } finally {
      if (generation === this.generation) {
        this.cancellations.delete(id);
        this.set({ ...this.value, cancelling: this.value.cancelling.filter(item => item !== id) });
      }
    }
  }
}
