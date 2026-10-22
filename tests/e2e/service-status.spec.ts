import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";

let server: PreviewServer;
const origin = "http://127.0.0.1:18174";
const ready = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "service-status-test" };

test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 18174, strictPort: true } });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server?.httpServer.close(() => resolve()));
});

async function mock(page: Page) {
  const state = {
    health: { status: 200, json: ready as unknown, abort: false },
    healthReads: 0,
    sessionChanges: 0,
    pending: null as Promise<void> | null,
  };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/health/ready")) {
      state.healthReads += 1;
      if (state.pending) await state.pending;
      if (state.health.abort) return route.abort("failed");
      return route.fulfill({ status: state.health.status, json: state.health.json });
    }
    if (path.endsWith("/auth/session")) {
      if (route.request().method() !== "GET") state.sessionChanges += 1;
      return route.fulfill({ json: { csrfToken: "status-csrf", user: { id: "status-listener", role: "user" } } });
    }
    if (path.endsWith("/me/profile")) return route.fulfill({ json: {
      user: { id: "status-listener", role: "user" }, nickname: null, avatar: null, avatarUploadSupported: false,
    } });
    return route.fulfill({ json: { items: [], nextCursor: null, nextAfter: null, libraryRevision: "1" } });
  });
  return state;
}

async function openStatus(page: Page) {
  await page.getByRole("button", { name: "服务状态", exact: true }).click();
  const panel = page.getByRole("region", { name: "服务状态详情", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

test("service status precedes settings and its panel supports dismissal and narrow light layouts", async ({ page }, info) => {
  await mock(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${origin}/#/library`);
  const trigger = page.getByRole("button", { name: "服务状态", exact: true });
  const settings = page.getByRole("button", { name: "设置", exact: true });
  await expect(trigger).toBeVisible();
  const statusBox = await trigger.boundingBox();
  const settingsBox = await settings.boundingBox();
  expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(settingsBox!.x);
  const panel = await openStatus(page);
  await expect(panel.getByText("运行正常", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("service-status-dark.png") });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await openStatus(page);
  await page.locator("#page-scroll").click({ position: { x: 20, y: 150 } });
  await expect(panel).toHaveCount(0);

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await openStatus(page);
  await page.screenshot({ path: info.outputPath("service-status-light.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(trigger).toBeInViewport();
  await expect(settings).toBeInViewport();
  await expect(panel).toBeInViewport();
  const panelBox = await panel.boundingBox();
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("service-status-mobile.png") });
});

test("manual checks distinguish unavailable and unreachable services and recover without changing the session", async ({ page }) => {
  const state = await mock(page);
  await page.goto(`${origin}/#/library`);
  const panel = await openStatus(page);
  const check = panel.getByRole("button", { name: "重新检查", exact: true });
  await expect(panel.getByText("运行正常", { exact: true })).toBeVisible();

  state.health = { status: 503, json: { ...ready, ready: false }, abort: false };
  await check.click();
  await expect(panel.getByText("服务未就绪", { exact: true })).toBeVisible();
  state.health.abort = true;
  await check.click();
  await expect(panel.getByText("无法连接", { exact: true })).toBeVisible();

  state.health = { status: 200, json: ready, abort: false };
  let release!: () => void;
  state.pending = new Promise<void>((resolve) => { release = resolve; });
  await check.click();
  await expect(panel.getByRole("button", { name: "正在检查…", exact: true })).toBeDisabled();
  release();
  state.pending = null;
  await expect(panel.getByText("运行正常", { exact: true })).toBeVisible();
  await expect(check).toBeEnabled();
  await expect(page.getByRole("button", { name: "账号菜单", exact: true })).toBeVisible();
  expect(state.sessionChanges).toBe(0);
});

test("automatic checks refresh after thirty seconds and when connectivity or page focus returns", async ({ page }) => {
  const state = await mock(page);
  await page.clock.install();
  await page.goto(`${origin}/#/library`);
  const panel = await openStatus(page);
  await expect(panel.getByText("运行正常", { exact: true })).toBeVisible();
  await expect.poll(() => state.healthReads).toBeGreaterThanOrEqual(2);
  const reads = state.healthReads;
  state.health = { status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } }, abort: false };
  await page.clock.fastForward(30_001);
  await expect.poll(() => state.healthReads).toBeGreaterThan(reads);
  await expect(panel.getByText("服务未就绪", { exact: true })).toBeVisible();

  for (const event of ["online", "focus", "visibilitychange"]) {
    const previous = state.healthReads;
    state.health = { status: 200, json: ready, abort: false };
    await page.evaluate((name) => {
      (name === "visibilitychange" ? document : window).dispatchEvent(new Event(name));
    }, event);
    await expect.poll(() => state.healthReads).toBeGreaterThan(previous);
    await expect(panel.getByText("运行正常", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "重新检查", exact: true })).toBeEnabled();
  }
});

test("incompatible, malformed and replaced services never report a healthy session", async ({ page }) => {
  const state = await mock(page);
  await page.goto(`${origin}/#/library`);
  const panel = await openStatus(page);
  const check = panel.getByRole("button", { name: "重新检查", exact: true });
  await expect(panel.getByText("运行正常", { exact: true })).toBeVisible();

  for (const json of [
    { ...ready, product: "AnotherProduct" },
    { ...ready, apiVersion: "2" },
    { ...ready, instanceId: "" },
    { ...ready, ready: "true" },
    null,
  ]) {
    state.health = { status: 200, json, abort: false };
    const reads = state.healthReads;
    await check.click();
    await expect.poll(() => state.healthReads).toBeGreaterThan(reads);
    await expect(check).toBeEnabled();
    await expect(panel.getByText("运行正常", { exact: true })).toHaveCount(0);
    await expect(panel.getByText("服务不兼容", { exact: true })).toBeVisible();
  }

  state.health.json = { ...ready, instanceId: "replacement-service" };
  await check.click();
  await expect(panel.getByText("服务已变更", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "账号菜单", exact: true })).toBeVisible();
  await expect(page.locator(".login-page")).toHaveCount(0);
  expect(state.sessionChanges).toBe(0);
});

test("a stalled health request times out after five seconds and permits retry", async ({ page }) => {
  const state = await mock(page);
  await page.clock.install();
  await page.goto(`${origin}/#/library`);
  const panel = await openStatus(page);
  const check = panel.getByRole("button", { name: "重新检查", exact: true });
  await expect(panel.getByText("运行正常", { exact: true })).toBeVisible();
  let release!: () => void;
  state.pending = new Promise<void>((resolve) => { release = resolve; });
  await check.click();
  await expect(panel.getByRole("button", { name: "正在检查…", exact: true })).toBeDisabled();
  await page.clock.fastForward(5_001);
  await expect(panel.getByText("无法连接", { exact: true })).toBeVisible();
  await expect(check).toBeEnabled();
  release();
  state.pending = null;
  await check.click();
  await expect(panel.getByText("运行正常", { exact: true })).toBeVisible();
});
