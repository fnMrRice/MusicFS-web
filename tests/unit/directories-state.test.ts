import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { DirectoriesApi, type PluginOperation } from "../../src/api/directories";
import { DirectorySettingsState } from "../../src/features/directories/state";

const operation = (status: PluginOperation["status"]): PluginOperation => ({ operationId: "operation-1", status, errorCode: null });
function fixture(savedId: string | null = null) {
  let id = savedId;
  const api = {
    configuration: vi.fn(async () => ({ revision: "r1", roots: [{ id: "existing", name: "Saved", pathConfigured: true }] })),
    save: vi.fn(async () => operation("applying")),
    operation: vi.fn(async () => operation("succeeded")),
  };
  const storage = { get: () => id, set: vi.fn((value: string | null) => { id = value; }) };
  const state = new DirectorySettingsState(api as unknown as DirectoriesApi, storage);
  return { api, storage, state };
}

describe("Music folder configuration state", () => {
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
    ], "r1", expect.any(String), undefined);
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
    expect(api.save).toHaveBeenLastCalledWith(expect.any(Array), "r2", expect.any(String), undefined);
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
    expect(api.save).toHaveBeenCalledWith([], "r1", expect.any(String), undefined);
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
});
