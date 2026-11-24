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
  additionOptions: ImportDefaults;
}
interface PendingSave { roots: MusicRoot[]; importDefaults: ImportDefaults; revision: string; key: string }
const defaultOptions = (): ImportDefaults => ({ recursive: true, maxDepth: 0, importLyrics: true, excludePatterns: [], skipHidden: true, respectNoMedia: true });
const settingsJSON = (roots: MusicRoot[], options: ImportDefaults) => JSON.stringify({ roots: [...roots].sort((a, b) => a.id.localeCompare(b.id)), options });
export interface OperationStorage { get(): string | null; set(id: string | null): void }

export class DirectorySettingsState extends Store<State> {
  private original = settingsJSON([], defaultOptions());
  private originalRoots = new Map<string, MusicRoot>();
  private pending: PendingSave | null = null;
  private operationId: string | null = null;
  constructor(private api: DirectoriesApi, private storage: OperationStorage,
    private operationAccepted?: (operation: PluginOperation) => void) {
    super({ roots: [], revision: "", loaded: false, busy: false, error: null, conflict: false, operation: null, saved: false,
      importDefaults: defaultOptions(), additionOptions: defaultOptions() });
  }
  get locked() { return this.value.busy || this.pending !== null || this.operationId !== null; }
  get dirty() { return settingsJSON(this.value.roots, this.value.importDefaults) !== this.original; }
  get additions() { return this.value.roots.filter((root) => !this.originalRoots.has(root.id)); }
  get savedRootIds() { return [...this.originalRoots.keys()]; }
  savedRoot(id: string) { return this.originalRoots.get(id); }
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
      const roots = config.roots.map(({ id, name, importDefaults }) => ({ id, name, importDefaults }));
      const importDefaults = { ...defaultOptions(), ...config.importOptions?.importDefaults };
      this.original = settingsJSON(roots, importDefaults);
      this.originalRoots = new Map(roots.map(root => [root.id, root]));
      this.patch({ roots, importDefaults, additionOptions: structuredClone(importDefaults),
        revision: config.revision, loaded: true, conflict: false });
    } catch (e) { if (!signal?.aborted) this.patch({ error: errorMessage(e) }); }
    finally { this.patch({ busy: false }); }
  }
  private edit(roots: MusicRoot[]) {
    if (!this.locked) this.patch({ roots, saved: false, error: null });
  }
  editRoot(id: string, changes: Partial<Pick<MusicRoot, "name" | "importDefaults">>) {
    if (this.locked || this.value.conflict || !this.value.loaded) return;
    if (changes.importDefaults && !this.validOptions(changes.importDefaults)) return;
    this.edit(this.value.roots.map((root) => root.id === id ? { ...root, ...structuredClone(changes) } : root));
  }
  editAdditions(options: ImportDefaults) {
    if (this.locked || this.value.conflict || !this.validOptions(options)) return;
    this.patch({ additionOptions: structuredClone(options), roots: this.value.roots.map((root) => !this.originalRoots.has(root.id)
      ? { ...root, importDefaults: structuredClone(options) } : root), saved: false, error: null });
  }
  removeRoot(id: string) {
    if (!this.value.conflict && this.value.loaded) this.edit(this.value.roots.filter((root) => root.id !== id));
  }
  toggleAddition(item: DirectoryItem) {
    if (this.locked || !this.value.loaded || this.value.conflict || item.configuredRootId !== null) return;
    const selected = this.value.roots.find(root => root.path === item.path);
    if (selected) this.removeRoot(selected.id);
    else if (item.available) this.edit([...this.value.roots, {
      id: `root-${crypto.randomUUID()}`, name: item.name, path: item.path,
      importDefaults: structuredClone(this.value.additionOptions),
    }]);
  }
  private validOptions(options: ImportDefaults) {
    return Number.isInteger(options.maxDepth) && options.maxDepth >= 0 && options.maxDepth <= 64;
  }
  async save(signal?: AbortSignal) {
    if (this.value.busy || this.operationId || this.value.conflict) return;
    this.pending ??= { roots: this.value.roots.map((root) => {
      const snapshot = structuredClone(root);
      const previous = this.originalRoots.get(root.id);
      if (previous && JSON.stringify(previous.importDefaults) === JSON.stringify(root.importDefaults)) delete snapshot.importDefaults;
      return snapshot;
    }), importDefaults: structuredClone(this.value.importDefaults), revision: this.value.revision, key: crypto.randomUUID() };
    this.patch({ busy: true, error: null, saved: false, operation: null });
    try {
      const p = this.pending;
      const operation = await this.api.save(p.roots, p.importDefaults, p.revision, p.key, signal);
      this.pending = null;
      this.operationId = operation.operationId;
      this.storage.set(operation.operationId);
      this.operationAccepted?.(operation);
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
