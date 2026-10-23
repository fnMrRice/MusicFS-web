import { EventEmitter } from "node:events";
import type { Page, Request, Response } from "@playwright/test";

const probes = new WeakMap<Page, EventEmitter>();

/** 观察真实 WebSocket 帧，沿用断言所需的少量 Request/Response 读取接口。 */
export function observeControl(page: Page): EventEmitter {
  const existing = probes.get(page);
  if (existing) return existing;
  const events = new EventEmitter(); probes.set(page, events);
  page.on("websocket", (socket) => {
    if (!socket.url().endsWith("/api/v1/control")) return;
    const requests = new Map<string, Request>();
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.type !== "request") return;
      const request = {
        url: () => new URL(`/api/v1${frame.path}`, socket.url().replace(/^ws/, "http")).href,
        method: () => frame.method, postDataJSON: () => frame.body,
      } as unknown as Request;
      requests.set(frame.id, request); events.emit("request", request);
    });
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.type !== "response") return;
      const request = requests.get(frame.id);
      if (!request) return;
      requests.delete(frame.id);
      events.emit("response", {
        request: () => request, url: () => request.url(), status: () => frame.status,
        ok: () => frame.status >= 200 && frame.status < 300,
        json: async () => frame.body, text: async () => JSON.stringify(frame.body),
      } as unknown as Response);
    });
    socket.on("close", () => requests.clear());
  });
  return events;
}

function waitControl<T>(page: Page, name: "request" | "response", predicate: (value: T) => boolean): Promise<T> {
  const events = observeControl(page);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for control ${name}`)); }, 15000);
    const listener = (value: T) => { if (predicate(value)) { cleanup(); resolve(value); } };
    const closed = () => { cleanup(); reject(new Error("Page closed while waiting for control frame")); };
    const cleanup = () => { clearTimeout(timeout); events.off(name, listener); page.off("close", closed); };
    events.on(name, listener); page.once("close", closed);
  });
}
export const waitControlRequest = (page: Page, predicate: (request: Request) => boolean) => waitControl(page, "request", predicate);
export const waitControlResponse = (page: Page, predicate: (response: Response) => boolean) => waitControl(page, "response", predicate);
export function onControlResponse(page: Page, listener: (response: Response) => void): void { observeControl(page).on("response", listener); }
