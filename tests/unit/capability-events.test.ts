import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityEvents } from "../../src/app/capability-events";
import { CapabilityResources } from "../../src/app/capability-resources";
import { ControlChannel, type ControlSocket } from "../../src/api/control-channel";
import { ApiClient } from "../../src/api/client";
import { PlaybackApi } from "../../src/api/playback";
import { playback } from "../fixtures/dto";

class FakeSocket extends EventTarget implements ControlSocket {
  sent: Record<string, unknown>[] = [];
  close = vi.fn();
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  emit(frame: unknown): void { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) })); }
  ready(): void {
    this.dispatchEvent(new Event("open"));
    this.emit({ type: "ready", instanceId: "server-1", heartbeatIntervalMs: 10000, heartbeatTimeoutMs: 30000 });
  }
  changed(revision = "r1", sequence = 1): void { this.emit({ type: "event", event: "capabilities.changed", data: { revision, sequence } }); }
}

function fixture() {
  const sockets: FakeSocket[] = [];
  const invalidate = vi.fn(), unauthorized = vi.fn(), instanceChanged = vi.fn();
  const check = vi.fn(async (_signal: AbortSignal): Promise<unknown> => undefined);
  const create = vi.fn((_url: string, _protocol: string) => {
    const socket = new FakeSocket(); sockets.push(socket); return socket;
  });
  const tasks = { ready: vi.fn(), disconnected: vi.fn(), receive: vi.fn() };
  const events = new CapabilityEvents(invalidate, check, unauthorized, instanceChanged, tasks, create, () => "ws://localhost/api/v1/control");
  return { events, channel: events.channel, sockets, invalidate, unauthorized, instanceChanged, check, create, tasks };
}

afterEach(() => vi.useRealTimers());

describe("authenticated control channel", () => {
  it("routes each changed resource once, reconciles on ready and unsubscribes", async () => {
    vi.useFakeTimers();
    const s = fixture(), playlist = vi.fn(), scans = vi.fn(), configuration = vi.fn();
    const unsubscribe = s.events.activity.subscribe("playlistSync", playlist);
    s.events.activity.subscribe("scans", scans);
    s.events.activity.subscribe("configuration", configuration);
    s.events.start("csrf"); const first = s.sockets[0]; first.ready();
    first.emit({ type: "event", event: "activity.changed", data: { resources: ["playlistSync", "playlistSync", "tasks"] } });
    for (const data of [null, {}, { resources: "scans" }])
      first.emit({ type: "event", event: "activity.changed", data });
    first.changed();
    expect(playlist).toHaveBeenCalledTimes(2); expect(scans).toHaveBeenCalledOnce();
    expect(s.tasks.ready).toHaveBeenCalledOnce();
    expect(s.tasks.receive).not.toHaveBeenCalled();
    first.emit({ type: "event", event: "tasks.snapshot", data: { subscriptionId: "s1" } });
    expect(s.tasks.receive).toHaveBeenCalledExactlyOnceWith({ subscriptionId: "s1" });
    expect(configuration).toHaveBeenCalledTimes(2);
    unsubscribe(); first.dispatchEvent(new Event("close")); await vi.advanceTimersByTimeAsync(500);
    first.emit({ type: "event", event: "activity.changed", data: { resources: ["scans"] } });
    s.sockets[1].ready();
    expect(playlist).toHaveBeenCalledTimes(2); expect(scans).toHaveBeenCalledTimes(2);
    expect(s.tasks.ready).toHaveBeenCalledTimes(2);
    s.events.stop();
  });
  it("uses one connection, authenticates without a URL token and refreshes after reconnect", async () => {
    vi.useFakeTimers();
    const s = fixture(); s.events.start("csrf-1"); s.events.start("csrf-1");
    expect(s.create).toHaveBeenCalledExactlyOnceWith("ws://localhost/api/v1/control", "musicfs.control.v1");
    s.sockets[0].ready();
    expect(s.sockets[0].sent).toEqual([{ type: "auth", csrfToken: "csrf-1" }]);
    expect(s.invalidate).toHaveBeenCalledOnce();
    s.sockets[0].changed(); s.sockets[0].changed();
    expect(s.invalidate).toHaveBeenCalledTimes(2);
    s.sockets[0].changed("r2", 2); expect(s.invalidate).toHaveBeenCalledTimes(3);
    s.sockets[0].dispatchEvent(new Event("close"));
    await vi.advanceTimersByTimeAsync(500);
    s.sockets[1].ready(); s.sockets[1].changed("r2", 2);
    expect(s.invalidate).toHaveBeenCalledTimes(5);
    s.events.stop();
  });

  it("releases old sessions and ignores late events, responses and checks", async () => {
    const s = fixture();
    s.check.mockImplementation((signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve(null))));
    s.events.start("csrf-1"); s.sockets[0].ready();
    const pending = s.channel.request("/playback/sessions", { method: "POST" });
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    s.events.start("csrf-2");
    await rejected;
    expect(s.sockets[0].close).toHaveBeenCalledOnce();
    s.sockets[0].ready(); s.sockets[0].changed("late", 4);
    expect(s.invalidate).toHaveBeenCalledOnce();
    s.sockets[1].dispatchEvent(new Event("error"));
    expect(s.check).toHaveBeenCalledOnce();
    s.events.stop();
    expect(s.check.mock.calls[0][0].aborted).toBe(true);
    expect(s.sockets[1].close).toHaveBeenCalledOnce();
  });

  it("refreshes the initial event after ready and rejects malformed capability data", () => {
    const s = fixture(); s.events.start("csrf"); s.sockets[0].ready();
    // ready 查询完成后订阅才建立，首次事件可能已是一个新版本。
    s.sockets[0].changed("changed-after-ready", 5);
    expect(s.invalidate).toHaveBeenCalledTimes(2);
    for (const data of [null, [], {}, { revision: 3, sequence: 1 }, { revision: "r", sequence: -1 },
      { revision: "r", sequence: 0.1 }, { revision: "r".repeat(257), sequence: 1 }])
      s.sockets[0].emit({ type: "event", event: "capabilities.changed", data });
    expect(s.invalidate).toHaveBeenCalledTimes(2); s.events.stop();
  });

  it("discards queued old-instance commands before restoring a restarted server", async () => {
    vi.useFakeTimers();
    const s = fixture(); s.events.start("csrf"); s.sockets[0].ready();
    s.sockets[0].dispatchEvent(new Event("close"));
    const pending = s.channel.request("/playback/sessions/old/seek", { method: "POST" });
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.advanceTimersByTimeAsync(500);
    s.sockets[1].dispatchEvent(new Event("open"));
    s.sockets[1].emit({ type: "ready", instanceId: "server-2", heartbeatIntervalMs: 10000, heartbeatTimeoutMs: 30000 });
    await rejected;
    expect(s.instanceChanged).toHaveBeenCalledOnce(); expect(s.sockets[1].sent).toHaveLength(1);
    expect(s.sockets[1].close).toHaveBeenCalledOnce(); s.events.stop();
  });

  it("queues until ready and correlates responses, preserving API errors", async () => {
    const s = fixture(); s.events.start("csrf");
    const pending = s.channel.request("/playback/sessions", { method: "POST", body: { sourceTrackId: "track-1" }, idempotencyKey: "key-1" });
    expect(s.sockets[0].sent).toEqual([]); s.sockets[0].ready();
    const frame = s.sockets[0].sent[1];
    expect(frame).toMatchObject({ type: "request", method: "POST", path: "/playback/sessions", body: { sourceTrackId: "track-1" }, idempotencyKey: "key-1" });
    s.sockets[0].emit({ type: "response", id: frame.id, status: 201, body: { sessionId: "session-1" } });
    await expect(pending).resolves.toEqual({ sessionId: "session-1" });
    const denied = s.channel.request("/playback/sessions", { method: "POST" });
    const rejection = expect(denied).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED", requestId: "request-2", retryAfter: 2 });
    s.sockets[0].emit({ type: "response", id: s.sockets[0].sent[2].id, status: 401,
      body: { error: { code: "AUTH_REQUIRED", message: "Session expired", requestId: "request-2", retryAfter: 2 } } });
    await rejection; expect(s.unauthorized).toHaveBeenCalledOnce(); s.events.stop();
  });

  it("never replays a mutation after a disconnect or timeout", async () => {
    vi.useFakeTimers();
    const s = fixture(); s.events.start("csrf"); s.sockets[0].ready();
    const pending = s.channel.request("/playback/sessions", { method: "POST" });
    const rejection = expect(pending).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    s.sockets[0].dispatchEvent(new Event("close")); await rejection;
    await vi.advanceTimersByTimeAsync(500); s.sockets[1].ready();
    expect(s.sockets[1].sent).toHaveLength(1);
    const timed = s.channel.request("/playback/sessions/session-1/seek", { method: "POST", timeoutMs: 50 });
    const timedRejection = expect(timed).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    await vi.advanceTimersByTimeAsync(50); await timedRejection;
    expect(s.sockets[1].sent).toHaveLength(2); s.events.stop();
  });

  it("removes aborted and timed out requests and ignores their late responses", async () => {
    vi.useFakeTimers();
    const s = fixture(); s.events.start("csrf");
    const abort = new AbortController();
    const pending = s.channel.request("/health/ready", { signal: abort.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    abort.abort(); await rejected;
    const timed = s.channel.request("/health/ready", { timeoutMs: 25 });
    const timeout = expect(timed).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(25); await timeout;
    s.sockets[0].ready(); expect(s.sockets[0].sent).toHaveLength(1); s.events.stop();
  });

  it("releases a late playback session after create was cancelled without replaying it", async () => {
    const s = fixture(); s.events.start("csrf"); s.sockets[0].ready();
    const client = new ApiClient(); client.controlTransport = s.channel;
    const api = new PlaybackApi(client), abort = new AbortController();
    const pending = api.create("track", { htmlAudio: true, formats: [] }, { forceProcessing: false, gainDb: 0, dspExecution: "client" }, "key", abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    const id = s.sockets[0].sent[1].id; abort.abort(); await rejected;
    s.sockets[0].emit({ type: "response", id, status: 201, body: playback() });
    expect(s.sockets[0].sent[2]).toMatchObject({ type: "request", method: "DELETE", path: "/playback/sessions/session-1" });
    s.sockets[0].emit({ type: "response", id: s.sockets[0].sent[2].id, status: 204 });
    s.events.stop();
  });

  it("cleans late timeout results, bounds cleanup records and clears them on session replacement", async () => {
    vi.useFakeTimers();
    const s = fixture(); s.events.start("csrf"); s.sockets[0].ready();
    const cleanup = vi.fn();
    const timed = s.channel.request("/playback/sessions", { method: "POST", timeoutMs: 5, onLateSuccess: cleanup });
    const rejection = expect(timed).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    const id = s.sockets[0].sent[1].id;
    await vi.advanceTimersByTimeAsync(5); await rejection;
    s.sockets[0].emit({ type: "response", id, status: 201, body: playback() });
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(playback());
    const abort = new AbortController();
    const pending = Array.from({ length: 128 }, () => s.channel.request("/playback/sessions", { method: "POST", signal: abort.signal, onLateSuccess: cleanup }).catch(() => {}));
    abort.abort(); await Promise.all(pending);
    await expect(s.channel.request("/playback/sessions", { method: "POST" })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    s.events.start("new-csrf"); s.sockets[0].emit({ type: "response", id: s.sockets[0].sent[2].id, status: 201, body: playback() });
    expect(cleanup).toHaveBeenCalledOnce(); s.events.stop();
  });

  it("distinguishes online transport, lifecycle readiness and disconnected status", () => {
    const s = fixture(); s.events.start("csrf");
    expect(s.channel.status.getSnapshot().phase).toBe("checking");
    s.sockets[0].ready(); expect(s.channel.status.getSnapshot().phase).toBe("online");
    s.sockets[0].emit({ type: "event", event: "lifecycle.changed", data: { instanceId: "wrong-instance", state: "ready" } });
    expect(s.channel.status.getSnapshot().phase).toBe("online");
    s.sockets[0].emit({ type: "event", event: "lifecycle.changed", data: { instanceId: "server-1", state: "ready" } });
    expect(s.channel.status.getSnapshot().phase).toBe("ready");
    s.sockets[0].emit({ type: "event", event: "lifecycle.changed", data: { instanceId: "server-1", state: "draining" } });
    s.sockets[0].emit({ type: "pong" }); expect(s.channel.status.getSnapshot().phase).toBe("not-ready");
    s.sockets[0].dispatchEvent(new Event("close")); expect(s.channel.status.getSnapshot().phase).toBe("unreachable");
    s.events.stop();
  });

  it("expires cleanup records after thirty seconds without retaining cancelled sessions indefinitely", async () => {
    vi.useFakeTimers();
    const s = fixture(); s.events.start("csrf"); s.sockets[0].ready();
    const socket = s.sockets[0], send = socket.send.bind(socket), cleanup = vi.fn();
    socket.send = (data) => { send(data); if (JSON.parse(data).type === "ping") socket.emit({ type: "pong" }); };
    const abort = new AbortController();
    const pending = s.channel.request("/playback/sessions", { method: "POST", signal: abort.signal, onLateSuccess: cleanup });
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    const id = socket.sent[1].id; abort.abort(); await rejected;
    await vi.advanceTimersByTimeAsync(30_001);
    socket.emit({ type: "response", id, status: 201, body: playback() });
    expect(cleanup).not.toHaveBeenCalled(); expect(socket.close).not.toHaveBeenCalled(); s.events.stop();
  });

  it("heartbeats reconnect after missing pong and stop cleanly on logout", async () => {
    vi.useFakeTimers();
    const s = fixture(); s.events.start("csrf"); s.sockets[0].ready();
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.sockets[0].sent.at(-1)).toEqual({ type: "ping" });
    s.sockets[0].emit({ type: "pong" });
    await vi.advanceTimersByTimeAsync(20000); expect(s.sockets[0].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000); expect(s.sockets[0].close).toHaveBeenCalledOnce();
    s.events.stop(); await vi.advanceTimersByTimeAsync(60000);
    expect(s.create).toHaveBeenCalledOnce();
  });

  it("bounds reconnection delay and pending command count", async () => {
    vi.useFakeTimers();
    const s = fixture(); s.events.start("csrf");
    for (let i = 0; i < 8; i++) {
      s.sockets.at(-1)!.dispatchEvent(new Event("close"));
      await vi.advanceTimersByTimeAsync(Math.min(30000, 500 * 2 ** i));
      expect(s.create).toHaveBeenCalledTimes(i + 2);
    }
    const pending = Array.from({ length: 128 }, () => s.channel.request("/health/ready").catch(() => {}));
    await expect(s.channel.request("/health/ready")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    s.events.stop(); await Promise.all(pending);
  });

  it("does not silently fall back to HTTP when no control channel is installed", async () => {
    const fetcher = vi.fn<typeof fetch>(); const client = new ApiClient(fetcher);
    await expect(client.control("/playback/sessions", { method: "POST" })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(ControlChannel).toBeDefined();
  });
});

describe("capability resource refresh", () => {
  it("invalidates only capability lists and releases subscriptions", () => {
    const resources = new CapabilityResources(); const listener = vi.fn(); const unsubscribe = resources.subscribe(listener);
    resources.invalidate();
    for (const key of ["providers", "settings-providers", "settings-plugins-false", "settings-plugins-true", "search-instances", "import-providers"])
      expect(resources.snapshot(key)).toBe(1);
    for (const instance of ["local-first", "local-second"]) expect(resources.snapshot(`settings-local-directories:${instance}`)).toBe(1);
    expect(resources.snapshot("playlist-1")).toBe(0); expect(listener).toHaveBeenCalledOnce();
    unsubscribe(); resources.invalidate(); expect(listener).toHaveBeenCalledOnce(); expect(resources.snapshot("providers")).toBe(2);
  });
});
