import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { DirectoriesApi, type LocalConfiguration, type PluginOperation } from "../../src/api/directories";
import { DirectorySettingsState } from "../../src/features/directories/state";

const defaults = { recursive: true, maxDepth: 0, importLyrics: true, excludePatterns: ["private/**"], skipHidden: true, respectNoMedia: true };
const first = { id: "first", name: "First", pathConfigured: true, importDefaults: { ...defaults, recursive: false } };
const second = { id: "second", name: "Second", pathConfigured: true, importDefaults: { ...defaults, maxDepth: 2 } };
const candidate = { name: "New", path: "/music/new", available: true, configuredRootId: null };
function fixture() {
  const config: LocalConfiguration = { revision: "r1", roots: [first, second], rootImportDefaultsSupported: true,
    importOptions: { importDefaults: defaults, schemaRevision: "local-import-v5" } };
  const api = {
    configuration: vi.fn(async () => structuredClone(config)),
    save: vi.fn(async (..._args: Parameters<DirectoriesApi["save"]>): Promise<PluginOperation> => ({ operationId: "op", status: "applying", errorCode: null })),
    operation: vi.fn(async (): Promise<PluginOperation> => ({ operationId: "op", status: "succeeded", errorCode: null })),
  };
  const state = new DirectorySettingsState(api as unknown as DirectoriesApi, { get: () => null, set: vi.fn() });
  return { config, api, state };
}

describe("Per-directory music configuration", () => {
  it("keeps saved directories selected during additions and only toggles new selections", async () => {
    const { state, api } = fixture();
    await state.start();
    state.toggleAddition({ name: "First", path: "/music/first", available: true, configuredRootId: "first" });
    expect(state.value.roots.map(root => root.id)).toEqual(["first", "second"]);
    expect(state.additions).toEqual([]);
    expect(state.dirty).toBe(false);
    state.toggleAddition({ ...candidate, available: false });
    expect(state.additions).toEqual([]);
    state.toggleAddition(candidate);
    expect(state.additions).toHaveLength(1);
    state.toggleAddition(candidate);
    expect(state.additions).toEqual([]);
    expect(state.dirty).toBe(false);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("applies addition settings only to new directories while preserving global and saved defaults", async () => {
    const { state, api } = fixture();
    await state.start();
    const saved = structuredClone(state.value.roots);
    const options = { ...defaults, recursive: false, skipHidden: false, respectNoMedia: false };
    state.editAdditions(options);
    expect(state.dirty).toBe(false);
    state.toggleAddition(candidate);
    state.toggleAddition({ ...candidate, name: "Other", path: "/music/other" });
    state.editAdditions({ ...options, recursive: true, maxDepth: 3 });
    expect(state.value.roots.slice(0, 2)).toEqual(saved);
    expect(state.value.importDefaults).toEqual(defaults);
    expect(state.additions.map(root => root.importDefaults)).toEqual(Array(2).fill({ ...options, recursive: true, maxDepth: 3 }));
    await state.save();
    expect(api.save).toHaveBeenCalledWith([{ id: "first", name: "First" }, { id: "second", name: "Second" }, ...state.additions], defaults, "r1", expect.any(String), undefined);
  });

  it("edits one directory without rebinding its path or changing another directory", async () => {
    const { state, api } = fixture();
    await state.start();
    const unchanged = structuredClone(state.value.roots[1]);
    state.editRoot("first", { name: "Renamed", importDefaults: { ...defaults, maxDepth: 1, skipHidden: false } });
    expect(state.value.roots[0]).toEqual({ id: "first", name: "Renamed", importDefaults: { ...defaults, maxDepth: 1, skipHidden: false } });
    expect(state.value.roots[1]).toEqual(unchanged);
    await state.save();
    expect(api.save).toHaveBeenCalledWith([
      { id: "first", name: "Renamed", importDefaults: { ...defaults, maxDepth: 1, skipHidden: false } }, { id: "second", name: "Second" },
    ], defaults, "r1", expect.any(String), undefined);
    state.removeRoot("second");
    expect(state.value.roots).toHaveLength(2);
  });

  it("removes only the requested root and leaves the remaining root configuration intact", async () => {
    const { state, api } = fixture();
    await state.start();
    state.removeRoot("first");
    await state.save();
    expect(api.save).toHaveBeenCalledWith([{ id: "second", name: "Second" }], defaults, "r1", expect.any(String), undefined);
  });

  it("preserves a conflicting edit and prevents further changes until explicitly reloaded", async () => {
    const { state, api } = fixture();
    await state.start();
    state.editRoot("first", { importDefaults: { ...defaults, maxDepth: 4 } });
    api.save.mockRejectedValueOnce(new ApiError("REVISION_CONFLICT", "Changed", 412));
    await state.save();
    const draft = structuredClone(state.value.roots);
    state.removeRoot("second");
    state.toggleAddition(candidate);
    state.editRoot("first", { name: "Ignored" });
    state.editAdditions({ ...defaults, recursive: false });
    await state.save();
    expect(state.value.conflict).toBe(true);
    expect(state.value.roots).toEqual(draft);
    expect(api.save).toHaveBeenCalledOnce();
    await state.reload();
    expect(state.value.conflict).toBe(false);
    expect(state.value.roots[0].importDefaults).toEqual(first.importDefaults);
    expect(state.dirty).toBe(false);
  });

  it("allows legacy servers to rename and add directories without sending per-directory options", async () => {
    const { state, api, config } = fixture();
    config.rootImportDefaultsSupported = false;
    config.roots = config.roots.map(({ id, name, pathConfigured }) => ({ id, name, pathConfigured }));
    await state.start();
    const saved = structuredClone(state.value.roots);
    state.editRoot("first", { importDefaults: { ...defaults, maxDepth: 1 } });
    state.editAdditions({ ...defaults, recursive: false });
    expect(state.value.roots).toEqual(saved);
    state.editRoot("first", { name: "Renamed" });
    state.toggleAddition(candidate);
    expect(state.additions[0]).not.toHaveProperty("importDefaults");
    await state.save();
    expect(api.save).toHaveBeenCalledWith([{ id: "first", name: "Renamed" }, { id: "second", name: "Second" }, ...state.additions], defaults, "r1", expect.any(String), undefined);
  });

  it("does not freeze inherited options when only a directory name changes", async () => {
    const { state, api } = fixture();
    await state.start();
    state.editRoot("first", { name: "Renamed" });
    await state.save();
    expect(api.save).toHaveBeenCalledWith([{ id: "first", name: "Renamed" }, { id: "second", name: "Second" }], defaults, "r1", expect.any(String), undefined);
  });
});
