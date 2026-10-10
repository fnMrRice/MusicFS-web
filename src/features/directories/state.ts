import { ApiError, errorMessage } from "../../api/client";
import { DirectoriesApi, type DirectoryItem, type ImportDefaults, type MusicRoot, type PluginOperation } from "../../api/directories";
import { Store } from "../../app/store";
import { directoryError } from "./errors";

interface State {
  roots: MusicRoot[];
  revision: string;
  loaded: boolean;
  busy: boolean;
  error: string | null;
  conflict: boolean;
  operation: PluginOperation | null;
  saved: boolean;
  importDefaults: ImportDefaults;
}
interface PendingSave { roots: MusicRoot[]; importDefaults: ImportDefaults; revision: string; key: string }
const defaultOptions = (): ImportDefaults => ({ recursive: true, maxDepth: 0, importLyrics: false, excludePatterns: [], skipHidden: true, respectNoMedia: true });
const settingsJSON = (roots: MusicRoot[], options: ImportDefaults) => JSON.stringify({ roots: [...roots].sort((a, b) => a.id.localeCompare(b.id)), options });
export interface OperationStorage { get(): string | null; set(id: string | null): void }

export class DirectorySettingsState extends Store<State> {
  private revision = "";
  private original = settingsJSON([], defaultOptions());
  private originalRoots: MusicRoot[] = [];
  private pending: PendingSave | null = null;
  private operationId: string | null = null;
  constructor(private api: DirectoriesApi, private storage: OperationStorage) {
    super({ roots: [], revision: "", loaded: false, busy: false, error: null, conflict: false, operation: null, saved: false, importDefaults: defaultOptions() });
  }
  get locked() { return this.value.busy || this.pending !== null || this.operationId !== null; }
  get dirty() { return settingsJSON(this.value.roots, this.value.importDefaults) !== this.original; }
  private patch(patch: Partial<State>) { this.set({ ...this.value, ...patch }); }
  async start(signal?: AbortSignal) {
    this.operationId = this.storage.get();
    if (this.operationId) await this.resume(signal);
    else await this.reload(signal);
  }
  async reload(signal?: AbortSignal) {
    if (this.locked) return;
    this.patch({ busy: true, error: null });
    try {
      const config = await this.api.configuration(signal);
      if (signal?.aborted) return;
      this.revision = config.revision;
      const roots = config.roots.map(({ id, name }) => ({ id, name }));
      const importDefaults = { ...defaultOptions(), ...config.importOptions?.importDefaults };
      this.original = settingsJSON(roots, importDefaults);
      this.originalRoots = roots;
      this.patch({ roots, importDefaults, revision: config.revision, loaded: true, conflict: false });
    } catch (e) { if (!signal?.aborted) this.patch({ error: errorMessage(e) }); }
    finally { this.patch({ busy: false }); }
  }
  edit(roots: MusicRoot[]) {
    if (!this.locked) this.patch({ roots, saved: false, error: null });
  }
  editRecursion(recursive: boolean, maxDepth: number) {
    if (this.locked || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 64) return;
    this.patch({ importDefaults: { ...this.value.importDefaults, recursive, maxDepth: recursive ? maxDepth : 0 }, saved: false, error: null });
  }
  editAdvanced(options: Pick<ImportDefaults, "skipHidden" | "respectNoMedia">) {
    if (!this.locked) this.patch({ importDefaults: { ...this.value.importDefaults, ...options }, saved: false, error: null });
  }
  toggle(item: DirectoryItem) {
    const selected = this.value.roots.find((root) => root.path === item.path || root.id === item.configuredRootId);
    if (selected) this.edit(this.value.roots.filter((root) => root.id !== selected.id));
    else this.select(item);
  }
  select(item: DirectoryItem) {
    if (this.locked || !item.available || this.value.roots.some((root) =>
      root.path === item.path || item.configuredRootId && root.id === item.configuredRootId)) return;
    const saved = this.originalRoots.find((root) => root.id === item.configuredRootId);
    this.edit([...this.value.roots, saved ?? { id: `root-${crypto.randomUUID()}`, name: item.name, path: item.path }]);
  }
  async save(signal?: AbortSignal) {
    if (this.value.busy || this.operationId || this.value.conflict) return;
    this.pending ??= { roots: this.value.roots.map((root) => ({ ...root })), importDefaults: structuredClone(this.value.importDefaults), revision: this.revision, key: crypto.randomUUID() };
    this.patch({ busy: true, error: null, saved: false, operation: null });
    try {
      const p = this.pending;
      const operation = await this.api.save(p.roots, p.importDefaults, p.revision, p.key, signal);
      this.pending = null;
      this.operationId = operation.operationId;
      this.storage.set(operation.operationId);
      await this.accept(operation, signal);
    } catch (e) {
      if (signal?.aborted) return;
      const uncertain = e instanceof ApiError && (e.status >= 500 || ["TIMEOUT", "NETWORK_ERROR", "INVALID_RESPONSE"].includes(e.code));
      if (!uncertain) this.pending = null;
      this.patch({ error: directoryError(e), conflict: e instanceof ApiError && (e.status === 412 || e.code === "REVISION_CONFLICT") });
    } finally { this.patch({ busy: false }); }
  }
  async resume(signal?: AbortSignal) {
    if (this.value.busy) return;
    if (!this.operationId) { await this.save(signal); return; }
    this.patch({ busy: true, error: null });
    try { await this.accept(await this.api.operation(this.operationId, signal), signal); }
    catch (e) {
      if (!signal?.aborted) {
        if (e instanceof ApiError && e.status === 404) {
          this.operationId = null;
          this.storage.set(null);
          this.patch({ conflict: true, error: "保存记录已不可用，请重新读取目录配置。" });
        } else this.patch({ error: errorMessage(e) });
      }
    } finally { this.patch({ busy: false }); }
  }
  private async accept(operation: PluginOperation, signal?: AbortSignal) {
    this.patch({ operation });
    if (operation.status === "applying" || operation.status === "draining") return;
    this.operationId = null;
    this.storage.set(null);
    this.patch({ busy: false });
    await this.reload(signal);
    if (operation.status === "succeeded") this.patch({ saved: true });
    else this.patch({ error: operation.status === "superseded"
      ? "目录配置已被其他操作替换，已重新读取当前设置。"
      : "目录设置未能应用，请检查插件状态后重试。", saved: false });
  }
}
