import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { DirectoriesApi, type LocalConfiguration, type PluginOperation } from "../../src/api/directories";
import { DirectorySettingsState } from "../../src/features/directories/state";

const operation = (status: PluginOperation["status"]): PluginOperation => ({ operationId: "operation-1", status, errorCode: null });
const defaultOptions = { recursive: true, maxDepth: 0, importLyrics: false, excludePatterns: [], skipHidden: true, respectNoMedia: true };
function fixture(savedId: string | null = null, operationAccepted?: (operation: PluginOperation) => void) {
  let id = savedId;
  const api = {
    configuration: vi.fn(async (): Promise<LocalConfiguration> => ({ revision: "r1", roots: [{ id: "existing", name: "Saved", pathConfigured: true }] })),
    save: vi.fn(async () => operation("applying")),
    operation: vi.fn(async () => operation("succeeded")),
  };
  const storage = { get: () => id, set: vi.fn((value: string | null) => { id = value; }) };
  const state = new DirectorySettingsState(api as unknown as DirectoriesApi, storage, operationAccepted);
  return { api, storage, state };
}

describe("Music folder configuration state", () => {
  it("hands accepted operations to the session before the directory modal can disappear", async () => {
    const accepted = vi.fn();
    const { state } = fixture(null, accepted);
    await state.start();
    await state.save();
    expect(accepted).toHaveBeenCalledExactlyOnceWith(operation("applying"));
    expect(state.value.saved).toBe(false);
    await state.resume();
    expect(accepted).toHaveBeenCalledTimes(1);
  });
  it("does not invent scan intent when restoring an existing directory operation", async () => {
    const accepted = vi.fn();
    const { state } = fixture("saved-remove-operation", accepted);
    await state.start();
    expect(state.value.saved).toBe(true);
    expect(accepted).not.toHaveBeenCalled();
  });
  it("keeps an empty configuration empty until a directory is explicitly selected", async () => {
    const { state, api } = fixture();
    api.configuration.mockResolvedValueOnce({ revision: "r1", roots: [] });
    await state.start();
    expect(state.value.roots).toEqual([]);
    expect(state.dirty).toBe(false);
    expect(api.save).not.toHaveBeenCalled();
    state.select({ name: "Music", path: "/Music", available: false, configuredRootId: null });
    expect(state.value.roots).toEqual([]);
    state.select({ name: "Selected", path: "/Music/Selected", available: true, configuredRootId: null });
    expect(state.value.roots).toEqual([{ id: expect.any(String), name: "Selected", path: "/Music/Selected" }]);
    expect(state.dirty).toBe(true);
    expect(api.save).not.toHaveBeenCalled();
  });
  it("recognizes saved directories after reload and restores their original identity when reselected", async () => {
    const { state } = fixture();
    await state.start();
    const item = { name: "Directory basename", path: "/Music/Collection", available: true, configuredRootId: "existing" };
    state.select(item);
    expect(state.value.roots).toEqual([{ id: "existing", name: "Saved" }]);
    state.edit([]);
    state.select(item);
    expect(state.value.roots).toEqual([{ id: "existing", name: "Saved" }]);
    expect(state.dirty).toBe(false);
    state.select({ name: "New", path: "/Music/New", available: true, configuredRootId: null });
    state.select({ name: "New", path: "/Music/New", available: true, configuredRootId: null });
    expect(state.value.roots).toHaveLength(2);
  });
  it("preserves existing root identity without rebinding its path and does not mutate until explicitly saved", async () => {
    const { state, api, storage } = fixture();
    await state.start();
    expect(state.value.roots).toEqual([{ id: "existing", name: "Saved" }]);
    state.edit([...state.value.roots, { id: "new", name: "New", path: "/Music/New" }]);
    expect(api.save).not.toHaveBeenCalled();
    await state.save();
    expect(api.save).toHaveBeenCalledWith([
      { id: "existing", name: "Saved" }, { id: "new", name: "New", path: "/Music/New" },
    ], defaultOptions, "r1", expect.any(String), undefined);
    expect(storage.get()).toBe("operation-1");
    expect(state.value.saved).toBe(false);
    expect(state.locked).toBe(true);
    state.edit([]);
    expect(state.value.roots).toHaveLength(2);
  });

  it("retries an uncertain save with identical body, revision and idempotency key", async () => {
    const { state, api } = fixture();
    await state.start();
    state.edit([]);
    api.save.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Lost response"));
    await state.save();
    expect(state.locked).toBe(true);
    expect(state.value.error).toBeTruthy();
    await state.resume();
    expect(api.save.mock.calls[1]).toEqual(api.save.mock.calls[0]);
    expect(state.value.operation?.status).toBe("applying");
  });

  it("keeps a conflicting draft and requires an explicit reload before another save", async () => {
    const { state, api } = fixture();
    await state.start();
    state.edit([]);
    api.save.mockRejectedValueOnce(new ApiError("REVISION_CONFLICT", "Changed", 412));
    await state.save();
    expect(state.value.conflict).toBe(true);
    expect(state.value.roots).toEqual([]);
    await state.save();
    expect(api.save).toHaveBeenCalledOnce();
    api.configuration.mockResolvedValueOnce({ revision: "r2", roots: [] });
    await state.reload();
    expect(state.value.conflict).toBe(false);
    state.edit([{ id: "new", name: "New", path: "/Music/New" }]);
    await state.save();
    expect(api.save).toHaveBeenLastCalledWith(expect.any(Array), defaultOptions, "r2", expect.any(String), undefined);
  });

  it("resumes a persisted operation after page reload and only reports success after completion", async () => {
    const { state, api, storage } = fixture("operation-1");
    api.operation.mockResolvedValueOnce(operation("draining"));
    await state.start();
    expect(api.save).not.toHaveBeenCalled();
    expect(state.value.saved).toBe(false);
    expect(state.locked).toBe(true);
    await state.resume();
    expect(state.value.saved).toBe(true);
    expect(state.locked).toBe(false);
    expect(storage.get()).toBeNull();
    expect(state.value.roots).toEqual([{ id: "existing", name: "Saved" }]);
  });

  it("allows clearing all roots and never treats a failed application as success", async () => {
    const { state, api } = fixture();
    await state.start();
    state.edit([]);
    await state.save();
    expect(api.save).toHaveBeenCalledWith([], defaultOptions, "r1", expect.any(String), undefined);
    api.operation.mockResolvedValueOnce(operation("failed"));
    await state.resume();
    expect(state.value.saved).toBe(false);
    expect(state.value.error).toBe("目录设置未能应用，请检查插件状态后重试。");
    expect(state.locked).toBe(false);
  });

  it("keeps a poll error recoverable and recovers from a removed operation record", async () => {
    const { state, api, storage } = fixture("operation-1");
    api.operation.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Offline"));
    await state.start();
    expect(storage.get()).toBe("operation-1");
    expect(state.locked).toBe(true);
    api.operation.mockRejectedValueOnce(new ApiError("NOT_FOUND", "Missing", 404));
    await state.resume();
    expect(storage.get()).toBeNull();
    expect(state.value.conflict).toBe(true);
    await state.reload();
    expect(state.value.loaded).toBe(true);
    expect(state.value.conflict).toBe(false);
  });
  it("saves recursive limits with roots while retaining lyric and exclusion settings", async () => {
    const { state, api } = fixture();
    const options = { ...defaultOptions, recursive: true, maxDepth: 3, importLyrics: true, excludePatterns: ["private/**"] };
    api.configuration.mockResolvedValueOnce({ revision: "r1", roots: [], importOptions: { importDefaults: options, schemaRevision: "local-import-v5" } });
    await state.start();
    expect(state.value.importDefaults).toEqual(options);
    expect(state.dirty).toBe(false);
    state.editRecursion(true, 0);
    expect(state.dirty).toBe(true);
    await state.save();
    expect(api.save).toHaveBeenCalledWith([], { ...options, maxDepth: 0 }, "r1", expect.any(String), undefined);
  });
  it("normalizes non-recursive scans to zero and rejects invalid finite depths", async () => {
    const { state, api } = fixture();
    await state.start();
    for (const invalid of [-1, 65, 1.5, NaN]) state.editRecursion(true, invalid);
    expect(state.dirty).toBe(false);
    state.editRecursion(true, 2);
    state.editRecursion(false, 2);
    expect(state.value.importDefaults).toEqual({ ...defaultOptions, recursive: false, maxDepth: 0 });
    await state.save();
    expect(api.save).toHaveBeenCalledWith([{ id: "existing", name: "Saved" }], { ...defaultOptions, recursive: false }, "r1", expect.any(String), undefined);
  });
  it("toggles selected folders independently and treats reselected saved roots as unchanged", async () => {
    const { state, api } = fixture();
    api.configuration.mockResolvedValueOnce({ revision: "r1", roots: [
      { id: "first", name: "First", pathConfigured: true }, { id: "second", name: "Second", pathConfigured: true },
    ] });
    await state.start();
    const first = { name: "Renamed basename", path: "/music/first", available: true, configuredRootId: "first" };
    state.toggle(first);
    expect(state.value.roots.map((root) => root.id)).toEqual(["second"]);
    state.toggle(first);
    expect(state.value.roots.find((root) => root.id === "first")).toEqual({ id: "first", name: "First" });
    expect(state.dirty).toBe(false);
    const child = { name: "Child", path: "/music/first/child", available: true, configuredRootId: null };
    state.toggle(child);
    expect(state.value.roots).toHaveLength(3);
    state.toggle(child);
    expect(state.dirty).toBe(false);
  });
  it("persists hidden and nomedia choices without changing recursion or other import options", async () => {
    const { state, api } = fixture();
    await state.start();
    expect(state.value.importDefaults).toEqual(defaultOptions);
    state.editRecursion(true, 4);
    state.editAdvanced({ skipHidden: false, respectNoMedia: false });
    await state.save();
    expect(api.save).toHaveBeenCalledWith([{ id: "existing", name: "Saved" }],
      { ...defaultOptions, maxDepth: 4, skipHidden: false, respectNoMedia: false }, "r1", expect.any(String), undefined);
  });
  it("preserves explicit false advanced settings when reloading the server configuration", async () => {
    const { state, api } = fixture();
    const options = { ...defaultOptions, skipHidden: false, respectNoMedia: false };
    api.configuration.mockResolvedValue({ revision: "r1", roots: [], importOptions: {
      importDefaults: options, schemaRevision: "local-import-v5",
    } });
    await state.start();
    expect(state.value.importDefaults).toEqual(options);
    expect(state.dirty).toBe(false);
    state.editRecursion(true, 2);
    await state.save();
    expect(api.save).toHaveBeenCalledWith([], { ...options, maxDepth: 2 }, "r1", expect.any(String), undefined);
    await state.resume();
    expect(state.value.importDefaults.skipHidden).toBe(false);
    expect(state.value.importDefaults.respectNoMedia).toBe(false);
  });
});
