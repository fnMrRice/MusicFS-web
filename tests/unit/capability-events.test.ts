import { describe, expect, it, vi } from "vitest";
import { CapabilityEvents, type CapabilityEventSource } from "../../src/app/capability-events";
import { CapabilityResources } from "../../src/app/capability-resources";

class FakeSource extends EventTarget implements CapabilityEventSource {
  close = vi.fn();
  emit(revision = "revision-1", sequence = 1): void {
    this.dispatchEvent(new MessageEvent("capabilities.changed", {
      data: JSON.stringify({ revision, sequence }),
    }));
  }
}

function fixture(check = vi.fn(async (_signal: AbortSignal) => {})) {
  const sources: FakeSource[] = [];
  const invalidate = vi.fn();
  const create = vi.fn((_url: string) => {
    const source = new FakeSource();
    sources.push(source);
    return source;
  });
  const events = new CapabilityEvents(invalidate, check, create);
  return { events, sources, invalidate, create, check };
}

describe("authenticated capability stream", () => {
  it("opens one stream for repeated starts and refreshes on initial event and reconnect", () => {
    const { events, sources, create, invalidate } = fixture();
    events.start("session-1");
    events.start("session-1");
    expect(create).toHaveBeenCalledExactlyOnceWith("/api/v1/events");
    const source = sources[0];
    source.emit();
    source.emit();
    expect(invalidate).toHaveBeenCalledTimes(1);
    source.emit("revision-2", 2);
    expect(invalidate).toHaveBeenCalledTimes(2);
    source.dispatchEvent(new Event("open"));
    source.emit("revision-2", 2);
    expect(invalidate).toHaveBeenCalledTimes(3);
    events.stop();
  });

  it("closes replaced and logged out streams, ignoring their late events", () => {
    const { events, sources, invalidate, check } = fixture();
    events.start("session-1");
    events.start("session-2");
    expect(sources[0].close).toHaveBeenCalledOnce();
    sources[0].emit();
    sources[0].dispatchEvent(new Event("error"));
    expect(invalidate).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    sources[1].emit();
    events.stop();
    events.stop();
    sources[1].emit("revision-2", 2);
    expect(sources[1].close).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("ignores malformed messages", () => {
    const { events, sources, invalidate } = fixture();
    events.start("session-1");
    for (const data of [
      "{", "null", "[]", "{}", JSON.stringify({ revision: 4, sequence: 1 }),
      JSON.stringify({ revision: "r", sequence: -1 }),
      JSON.stringify({ revision: "r", sequence: 0.5 }),
      JSON.stringify({ revision: "r", sequence: Number.MAX_SAFE_INTEGER + 1 }),
      JSON.stringify({ revision: "r".repeat(257), sequence: 1 }),
      " ".repeat(4097), { revision: "r", sequence: 1 },
    ]) sources[0].dispatchEvent(new MessageEvent("capabilities.changed", { data }));
    expect(invalidate).not.toHaveBeenCalled();
    sources[0].emit("r", 0);
    expect(invalidate).toHaveBeenCalledOnce();
    events.stop();
  });

  it("coalesces authentication checks and aborts a pending check on logout", async () => {
    let release!: () => void;
    const check = vi.fn((_signal: AbortSignal) => new Promise<void>((resolve) => { release = resolve; }));
    const { events, sources } = fixture(check);
    events.start("session-1");
    sources[0].dispatchEvent(new Event("error"));
    sources[0].dispatchEvent(new Event("error"));
    expect(check).toHaveBeenCalledOnce();
    const signal = check.mock.calls[0][0];
    expect(signal.aborted).toBe(false);
    events.stop();
    expect(signal.aborted).toBe(true);
    release();
    await Promise.resolve();
    expect(sources[0].close).toHaveBeenCalledOnce();
  });

  it("keeps network failures recoverable and allows authentication failure to close the stream", async () => {
    const check = vi.fn(async (_signal: AbortSignal): Promise<void> => { throw new Error("Network unavailable"); });
    const { events, sources, invalidate } = fixture(check);
    events.start("session-1");
    sources[0].dispatchEvent(new Event("error"));
    expect(check).toHaveBeenCalledOnce();
    await check.mock.results[0].value.catch(() => {});
    await Promise.resolve();
    expect(sources[0].close).not.toHaveBeenCalled();
    sources[0].dispatchEvent(new Event("open"));
    sources[0].emit();
    expect(invalidate).toHaveBeenCalledOnce();
    check.mockImplementation(async () => { events.stop(); });
    sources[0].dispatchEvent(new Event("error"));
    await vi.waitFor(() => expect(sources[0].close).toHaveBeenCalledOnce());
  });
});

describe("capability resource refresh", () => {
  it("invalidates only capability lists and releases subscriptions", () => {
    const resources = new CapabilityResources();
    const listener = vi.fn();
    const unsubscribe = resources.subscribe(listener);
    resources.invalidate();
    for (const key of ["providers", "settings-providers", "settings-plugins-false", "settings-plugins-true", "search-instances", "import-providers"])
      expect(resources.snapshot(key)).toBe(1);
    for (const instance of ["local-first", "local-second"])
      expect(resources.snapshot(`settings-local-directories:${instance}`)).toBe(1);
    expect(resources.snapshot("playlist-1")).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    resources.invalidate();
    expect(listener).toHaveBeenCalledOnce();
    expect(resources.snapshot("providers")).toBe(2);
  });
});
