import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";
import { startDevServer, startServer, type TestServer } from "./server";
import { eventProxy } from "../fixtures/event-proxy";

interface StreamProbe {
  created: number;
  closed: number;
  opened: number;
  changed: number;
  errors: number;
}
declare global {
  interface Window { capabilityStreamProbe: StreamProbe }
}

let server: TestServer;
let stopDev: (() => Promise<void>) | undefined;
let proxy: Awaited<ReturnType<typeof eventProxy>>;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await startServer();
  proxy = await eventProxy(server.origin);
  stopDev = await startDevServer(proxy.origin);
});
test.afterAll(async () => { await stopDev?.(); await proxy?.stop(); await server?.stop(); });

test("StrictMode uses one real event stream and refreshes authorized capabilities after changes and reconnect", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    const probe = window.capabilityStreamProbe = { created: 0, closed: 0, opened: 0, changed: 0, errors: 0 };
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        ++probe.created;
        this.addEventListener("open", () => ++probe.opened);
        this.addEventListener("capabilities.changed", () => ++probe.changed);
        this.addEventListener("error", () => ++probe.errors);
      }
      override close(): void { ++probe.closed; super.close(); }
    };
  });
  let providerReads = 0;
  let onlineReads = 0;
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/provider-instances") ++providerReads;
    if (path === "/api/v1/online-instances") ++onlineReads;
  });
  // The development build exercises React StrictMode's effect replay.
  const origin = "http://127.0.0.1:5173";
  await login(page, { ...server, origin });
  await expect.poll(() => page.evaluate(() => window.capabilityStreamProbe.changed)).toBeGreaterThan(0);
  await expect.poll(() => providerReads).toBeGreaterThan(0);
  await expect(page.getByRole("option", { name: "本地音乐文件", exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => window.capabilityStreamProbe.created)).toBe(1);

  const sessionResponse = await page.request.get(`${origin}/api/v1/auth/session`);
  const session = await sessionResponse.json();
  const change = async (enabled: boolean) => {
    const snapshot = await (await page.request.get(`${origin}/api/v1/admin/plugins`)).json();
    const response = await page.request.put(`${origin}/api/v1/admin/plugin-instances/local/state`, {
      headers: { Origin: origin, "X-CSRF-Token": session.csrfToken, "If-Match": `"${snapshot.revision}"`, "Idempotency-Key": crypto.randomUUID() },
      data: { enabled, mode: "drain" },
    });
    expect(response.status()).toBe(202);
    const operation = await response.json();
    await expect.poll(async () => {
      const result = await page.request.get(`${origin}/api/v1/admin/plugin-operations/${operation.operationId}`);
      return (await result.json()).status;
    }).toBe("succeeded");
  };
  const beforeDisable = providerReads;
  await change(false);
  await expect.poll(() => providerReads).toBeGreaterThan(beforeDisable);

  await page.getByRole("link", { name: "搜索", exact: true }).click();
  await expect.poll(() => onlineReads).toBeGreaterThan(0);
  const beforeEnable = onlineReads;
  await change(true);
  await expect.poll(() => onlineReads).toBeGreaterThan(beforeEnable);

  const beforeReconnect = onlineReads;
  expect(proxy.interrupt()).toBe(1);
  await expect.poll(() => page.evaluate(() => window.capabilityStreamProbe.errors)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.capabilityStreamProbe.opened)).toBeGreaterThan(1);
  await expect.poll(() => onlineReads).toBeGreaterThan(beforeReconnect);
  expect(await page.evaluate(() => window.capabilityStreamProbe.created)).toBe(1);

  await logout(page);
  await expect(page.getByLabel("管理员登录令牌")).toBeVisible();
  expect(await page.evaluate(() => window.capabilityStreamProbe.closed)).toBe(1);
});
