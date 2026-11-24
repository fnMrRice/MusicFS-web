import type { Page, Request, Route, WebSocketRoute } from "@playwright/test";

/** 让既有业务夹具同时接收 HTTP 资源请求与真实 WebSocket 控制帧。 */
export async function routeApi(page: Page, handler: (route: Route) => Promise<unknown> | unknown, pattern = "**/api/v1/**") {
  const sockets = new Set<WebSocketRoute>();
  const control = {
    lifecycle: null as string | null, pings: 0, handleTaskSubscriptions: false,
    event: (event: string, data: unknown) => sockets.forEach(socket => socket.send(JSON.stringify({ type: "event", event, data }))),
    disconnect: () => sockets.forEach(socket => socket.close({ code: 1011, reason: "Fixture interruption" })),
  };
  await page.route(pattern, handler);
  await page.routeWebSocket("**/api/v1/control", (socket) => {
    sockets.add(socket); socket.onClose(() => { sockets.delete(socket); });
    socket.onMessage(async (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "auth") {
        socket.send(JSON.stringify({ type: "ready", instanceId: "fixture", heartbeatIntervalMs: 10000, heartbeatTimeoutMs: 30000 }));
        socket.send(JSON.stringify({ type: "event", event: "capabilities.changed", data: { revision: "fixture", sequence: 0 } }));
        if (control.lifecycle) socket.send(JSON.stringify({ type: "event", event: "lifecycle.changed", data: { instanceId: "fixture", state: control.lifecycle } }));
        return;
      }
      if (frame.type === "ping") { ++control.pings; socket.send(JSON.stringify({ type: "pong" })); return; }
      if (frame.type !== "request") return;
      if (frame.path === "/tasks/subscription" && !control.handleTaskSubscriptions) {
        socket.send(JSON.stringify({ type: "response", id: frame.id, status: 204 }));
        socket.send(JSON.stringify({ type: "event", event: "tasks.snapshot", data: {
          subscriptionId: frame.body.subscriptionId, page: { items: [], activeCount: 0, nextCursor: null }, changed: [], reset: true,
        } }));
        return;
      }
      const request = {
        url: () => new URL(`/api/v1${frame.path}`, socket.url().replace(/^ws/, "http")).href,
        method: () => frame.method, postDataJSON: () => frame.body,
        postData: () => frame.body === undefined ? null : JSON.stringify(frame.body),
        headers: () => ({ "idempotency-key": frame.idempotencyKey }),
      } as unknown as Request;
      const route = {
        request: () => request,
        abort: async () => socket.close({ code: 1011, reason: "Fixture interruption" }),
        fulfill: async (options: Parameters<Route["fulfill"]>[0] = {}) => {
          const body = options.json ?? (options.body ? JSON.parse(String(options.body)) : undefined);
          socket.send(JSON.stringify({ type: "response", id: frame.id, status: options.status ?? 200, body }));
        },
      } as Route;
      await handler(route);
    });
  });
  return control;
}
