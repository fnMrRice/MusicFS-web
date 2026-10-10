import { test, expect } from "@playwright/test";
import { preview, type PreviewServer } from "vite";

test.use({ locale: "zh-CN" });

let server: PreviewServer;
const origin = "http://127.0.0.1:18139";
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 18139, strictPort: true } });
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server?.httpServer.close(() => resolve()));
});

test("settings show pending, disabled and ready plugins and refresh their state", async ({ page }) => {
  let localState = "pending_configuration";
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "bundle-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "test", user: { id: "admin", role: "admin" } };
    if (path.endsWith("/admin/plugins")) json = { items: [
      { pluginId: "musicfs.localfiles", instances: [{ instanceId: "local", name: "Local test", runtimeState: localState }] },
      { pluginId: "musicfs.ncm", instances: [{ instanceId: "ncm", name: "NCM test", runtimeState: "disabled" }] },
      { pluginId: "musicfs.scraper.local", instances: [{ instanceId: "scraper", name: "Scraper test", runtimeState: "ready" }] },
    ] };
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = page.locator(".settings-card").filter({ has: page.getByRole("heading", { name: "插件状态" }) });
  await expect(card.getByText("待配置", { exact: true })).toBeVisible();
  await expect(card.getByText("已禁用", { exact: true })).toBeVisible();
  await expect(card.getByText("请从允许访问的目录中选择音乐目录。")).toBeVisible();
  localState = "ready";
  await card.getByRole("button", { name: "刷新插件状态" }).click();
  await expect(card.getByText("可用", { exact: true })).toHaveCount(2);
  await expect(card.getByText("待配置", { exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("musicfs:language", "en"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Plugin status" })).toBeVisible();
});
