import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { DirectoriesApi, type LocalConfiguration, type PluginOperation } from "../../src/api/directories";
import { DirectorySettingsState } from "../../src/features/directories/state";

const operation = (status: PluginOperation["status"]): PluginOperation => ({ operationId: "operation-1", status, errorCode: null });
const newDirectory = { name: "New", path: "/Music/New", available: true, configuredRootId: null };
const defaultOptions = { recursive: true, maxDepth: 0, importLyrics: true, excludePatterns: [], skipHidden: true, respectNoMedia: true };
function fixture(savedId: string | null = null, operationAccepted?: (operation: PluginOperation) => void) {
  let id = savedId;
  const api = {
    configuration: vi.fn(async (): Promise<LocalConfiguration> => ({ revision: "r1", roots: [{ id: "existing", name: "Saved", pathConfigured: true, importDefaults: defaultOptions }] })),
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
    state.toggleAddition({ name: "Music", path: "/Music", available: false, configuredRootId: null });
    expect(state.value.roots).toEqual([]);
    state.toggleAddition({ name: "Selected", path: "/Music/Selected", available: true, configuredRootId: null });
    expect(state.value.roots).toEqual([{ id: expect.any(String), name: "Selected", path: "/Music/Selected", importDefaults: defaultOptions }]);
    expect(state.dirty).toBe(true);
    expect(api.save).not.toHaveBeenCalled();
  });
  it("preserves existing root identity without rebinding its path and does not mutate until explicitly saved", async () => {
    const { state, api, storage } = fixture();
    await state.start();
    expect(state.value.roots).toEqual([{ id: "existing", name: "Saved", importDefaults: defaultOptions }]);
    state.toggleAddition(newDirectory);
    expect(api.save).not.toHaveBeenCalled();
    await state.save();
    expect(api.save).toHaveBeenCalledWith([
      { id: "existing", name: "Saved" }, { id: expect.any(String), name: "New", path: "/Music/New", importDefaults: defaultOptions },
    ], defaultOptions, "r1", expect.any(String), undefined);
    expect(storage.get()).toBe("operation-1");
    expect(state.value.saved).toBe(false);
    expect(state.locked).toBe(true);
    state.removeRoot("existing");
    expect(state.value.roots).toHaveLength(2);
  });

  it("retries an uncertain save with identical body, revision and idempotency key", async () => {
    const { state, api } = fixture();
    await state.start();
    state.removeRoot("existing");
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
    state.removeRoot("existing");
    api.save.mockRejectedValueOnce(new ApiError("REVISION_CONFLICT", "Changed", 412));
    await state.save();
    expect(state.value.conflict).toBe(true);
    expect(state.value.roots).toEqual([]);
    await state.save();
    expect(api.save).toHaveBeenCalledOnce();
    api.configuration.mockResolvedValueOnce({ revision: "r2", roots: [] });
    await state.reload();
    expect(state.value.conflict).toBe(false);
    state.toggleAddition(newDirectory);
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
    expect(state.value.roots).toEqual([{ id: "existing", name: "Saved", importDefaults: defaultOptions }]);
  });

  it("allows clearing all roots and never treats a failed application as success", async () => {
    const { state, api } = fixture();
    await state.start();
    state.removeRoot("existing");
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
  it("uses instance defaults for additions and saves overrides only on selected roots", async () => {
    const { state, api } = fixture();
    const options = { ...defaultOptions, maxDepth: 3, skipHidden: false, respectNoMedia: false, excludePatterns: ["private/**"] };
    api.configuration.mockResolvedValue({ revision: "r1", roots: [], importOptions: {
      importDefaults: options, schemaRevision: "local-import-v5",
    } });
    await state.start();
    expect(state.value.additionOptions).toEqual(options);
    for (const invalid of [-1, 65, 1.5, NaN]) state.editAdditions({ ...options, maxDepth: invalid });
    expect(state.value.additionOptions).toEqual(options);
    state.toggleAddition(newDirectory);
    state.editAdditions({ ...options, recursive: false, maxDepth: 0 });
    await state.save();
    expect(api.save).toHaveBeenCalledWith([{
      id: expect.any(String), name: "New", path: "/Music/New", importDefaults: { ...options, recursive: false, maxDepth: 0 },
    }], options, "r1", expect.any(String), undefined);
    await state.resume();
    expect(state.value.importDefaults).toEqual(options);
  });
});
