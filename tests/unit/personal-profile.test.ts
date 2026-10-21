import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import type { PersonalProfile } from "../../src/api/profile";
import { PersonalProfileState } from "../../src/app/personal-profile";
import { deferred } from "../fixtures/dto";

const profile = (id = "alice", nickname: string | null = "Alice"): PersonalProfile => ({ user: { id, role: "admin" }, nickname });

describe("Personal profile state", () => {
  it("clears the previous session immediately and ignores late reads, even for the same user", async () => {
    const first = deferred<PersonalProfile>();
    const second = deferred<PersonalProfile>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce(profile("bob", "Bob"));
    const state = new PersonalProfileState({ read, save: vi.fn() });
    state.setUser("alice");
    const old = state.load();
    state.setUser(null);
    expect(read.mock.calls[0][0].aborted).toBe(true);
    expect(state.state.value).toEqual({ data: null, loading: false, saving: false, error: null });
    state.setUser("alice");
    const current = state.load();
    first.resolve(profile("alice", "Old session"));
    await old;
    expect(state.state.value.data).toBeNull();
    expect(state.state.value.loading).toBe(true);
    second.resolve(profile("alice", "New session"));
    await current;
    expect(state.state.value.data?.nickname).toBe("New session");
    state.setUser("bob");
    expect(state.state.value.data).toBeNull();
    await state.load();
  });

  it("ignores a late save after an account switch", async () => {
    const pending = deferred<PersonalProfile>();
    const read = vi.fn().mockResolvedValueOnce(profile()).mockResolvedValueOnce(profile("bob", "Bob"));
    const save = vi.fn().mockReturnValue(pending.promise);
    const state = new PersonalProfileState({ read, save });
    state.setUser("alice");
    await state.load();
    const saving = state.save("Updated Alice");
    state.setUser("bob");
    await state.load();
    expect(save.mock.calls[0][1].aborted).toBe(true);
    pending.resolve(profile("alice", "Updated Alice"));
    expect(await saving).toBe(false);
    expect(state.state.value.data).toEqual(profile("bob", "Bob"));
  });

  it("lets saving supersede a read and prevents concurrent reloads or duplicate saves", async () => {
    const reading = deferred<PersonalProfile>();
    const saving = deferred<PersonalProfile>();
    const read = vi.fn().mockReturnValue(reading.promise);
    const save = vi.fn().mockReturnValue(saving.promise);
    const state = new PersonalProfileState({ read, save });
    state.setUser("alice");
    const stale = state.load();
    const pending = state.save("New name");
    expect(read.mock.calls[0][0].aborted).toBe(true);
    await state.load();
    expect(await state.save("Duplicate")).toBe(false);
    expect(read).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][1].aborted).toBe(false);
    saving.resolve(profile("alice", "New name"));
    expect(await pending).toBe(true);
    reading.resolve(profile("alice", "Old name"));
    await stale;
    expect(state.state.value).toEqual({ data: profile("alice", "New name"), loading: false, saving: false, error: null });
  });

  it("preserves known data when loading or saving fails, then allows retry and clearing", async () => {
    const read = vi.fn().mockResolvedValueOnce(profile()).mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Offline"));
    const save = vi.fn().mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Offline"))
      .mockResolvedValueOnce(profile("alice", null));
    const state = new PersonalProfileState({ read, save });
    state.setUser("alice");
    await state.load();
    await state.load();
    expect(state.state.value.data).toEqual(profile());
    expect(state.state.value.error).toContain("无法连接");
    expect(await state.save("Unsaved")).toBe(false);
    expect(state.state.value.data).toEqual(profile());
    expect(state.state.value.saving).toBe(false);
    expect(await state.save(null)).toBe(true);
    expect(state.state.value.data?.nickname).toBeNull();
    expect(state.state.value.error).toBeNull();
  });

  it("rejects a response for another account and never requests data while signed out", async () => {
    const read = vi.fn().mockResolvedValue(profile("bob", "Private name"));
    const save = vi.fn().mockResolvedValue(profile("bob", "Private name"));
    const state = new PersonalProfileState({ read, save });
    await state.load();
    expect(await state.save("Name")).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    state.setUser("alice");
    await state.load();
    expect(state.state.value.data).toBeNull();
    expect(state.state.value.error).toContain("无法识别");
    expect(await state.save("Alice")).toBe(false);
    expect(state.state.value.data).toBeNull();
    expect(state.state.value.error).toContain("无法识别");
  });
});
