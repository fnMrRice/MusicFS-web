import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackSessionRenewal } from "../../../src/app/playback-session-renewal";
import { deferred } from "../../fixtures/dto";

const minute = 60_000;
const expiresIn = (minutes: number) => new Date(Date.now() + minutes * minute).toISOString();
const session = (minutes: number) => ({ csrfToken: "csrf", user: { id: "user", role: "owner" }, expiresAt: expiresIn(minutes) });
const playback = (sessionId: string, minutes: number) => ({ sessionId, expiresAt: expiresIn(minutes) });
const advance = (minutes: number) => vi.advanceTimersByTimeAsync(minutes * minute);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-25T07:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); });

describe("playback session renewal", () => {
  it.each([[6, 20], [20, 6]])("renews before either deadline and keeps playing past the original expiry", async (loginMinutes, trackMinutes) => {
    const refresh = vi.fn(async () => ({ expiresAt: expiresIn(6) }));
    const renewal = new PlaybackSessionRenewal(refresh);
    renewal.setSession(session(loginMinutes));
    const current = playback("first", trackMinutes);
    renewal.setPlayback(current, true);
    await advance(2);
    renewal.setPlayback(current, true);
    await advance(1);
    expect(refresh).toHaveBeenCalledOnce();
    await advance(6);
    expect(refresh).toHaveBeenCalledTimes(3);
    renewal.setPlayback(current, false);
    await advance(30);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("renews the playback resource even when authenticated requests keep the login alive", async () => {
    const refresh = vi.fn(async () => ({ expiresAt: expiresIn(6) }));
    const renewal = new PlaybackSessionRenewal(refresh);
    renewal.setSession(session(20));
    renewal.setPlayback(playback("track", 6), true);
    await advance(1);
    renewal.activity();
    await advance(1);
    renewal.activity();
    await advance(1);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps one pending request and drops late responses after a track change or logout", async () => {
    const first = deferred<{ expiresAt: string }>();
    const second = deferred<{ expiresAt: string }>();
    const refresh = vi.fn((id: string, _signal: AbortSignal) => id === "old" ? first.promise : second.promise);
    const renewal = new PlaybackSessionRenewal(refresh);
    renewal.setSession(session(60));
    renewal.setPlayback(playback("old", 6), true);
    await advance(4);
    expect(refresh).toHaveBeenCalledOnce();
    renewal.setPlayback(playback("new", 8), true);
    expect(refresh.mock.calls[0][1].aborted).toBe(true);
    first.resolve({ expiresAt: expiresIn(60) });
    await advance(4);
    expect(refresh.mock.calls.map(([id]) => id)).toEqual(["old", "new"]);
    renewal.setSession(null);
    expect(refresh.mock.calls[1][1].aborted).toBe(true);
    second.resolve({ expiresAt: expiresIn(8) });
    await advance(60);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
