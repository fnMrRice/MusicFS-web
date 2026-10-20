import { test, expect } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { instanceIds, localPlugin, ncmPlugin, scraperPlugin, neteasePlugin } from "../fixtures/plugins";

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
      { pluginId: localPlugin.id, plugin: localPlugin, supportsMultipleInstances: false, instances: [{ instanceId: instanceIds.local, name: "Local test", runtimeState: localState }] },
      { pluginId: ncmPlugin.id, plugin: ncmPlugin, supportsMultipleInstances: false, instances: [{ instanceId: instanceIds.ncm, name: "NCM test", runtimeState: "disabled" }] },
      { pluginId: scraperPlugin.id, plugin: scraperPlugin, supportsMultipleInstances: false, instances: [{ instanceId: instanceIds.scraper, name: "Scraper test", runtimeState: "ready" }] },
    ] };
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = page.locator(".settings-card").filter({ has: page.getByRole("heading", { name: "插件状态" }) });
  await expect(card.getByText("待配置", { exact: true })).toBeVisible();
  await expect(card.getByText("已禁用", { exact: true })).toBeVisible();
  await expect(card.getByText("请从允许访问的目录中选择音乐目录。")).toBeVisible();
  await expect(card.getByText("本地音乐", { exact: true })).toBeVisible();
  await expect(card.getByText("NCM 解密", { exact: true })).toBeVisible();
  await expect(card.getByText(/Local test|NCM test|Scraper test/)).toHaveCount(0);
  await expect(card.getByText(instanceIds.local, { exact: false })).toHaveCount(0);
  localState = "ready";
  await card.getByRole("button", { name: "刷新插件状态" }).click();
  await expect(card.getByText("可用", { exact: true })).toHaveCount(2);
  await expect(card.getByText("待配置", { exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("musicfs:language", "en"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Plugin status" })).toBeVisible();
  await expect(page.getByText("Local Music", { exact: true })).toBeVisible();
});

test("settings show restart-required disable while the plugin remains available", async ({ page }) => {
  let restartRequired = true;
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "restart-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "test", user: { id: "admin", role: "admin" } };
    if (path.endsWith("/admin/plugins")) json = { restartRequired, items: [
      { pluginId: ncmPlugin.id, plugin: ncmPlugin, supportsMultipleInstances: false, instances: [{ instanceId: instanceIds.ncm, name: "NCM test", runtimeState: restartRequired ? "ready" : "disabled", reason: restartRequired ? "RESTART_REQUIRED" : null }] },
    ] };
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = page.locator(".settings-card").filter({ has: page.getByRole("heading", { name: "插件状态" }) });
  await expect(card.getByText("配置变更需要重启服务端后生效。", { exact: true })).toBeVisible();
  await expect(card.getByText("等待重启后停用。", { exact: true })).toBeVisible();
  await expect(card.getByText("可用", { exact: true })).toBeVisible();
  await expect(card.getByText("已禁用", { exact: true })).toHaveCount(0);
  restartRequired = false;
  await card.getByRole("button", { name: "刷新插件状态" }).click();
  await expect(card.getByText("已禁用", { exact: true })).toBeVisible();
  await expect(card.getByText("配置变更需要重启服务端后生效。", { exact: true })).toHaveCount(0);
  await expect(card.getByText("等待重启后停用。", { exact: true })).toHaveCount(0);
});

test("plugin aliases and bound usernames identify multiple UUID instances and refresh after logout", async ({ page }) => {
  let bound = true;
  const plugin = { ...neteasePlugin, id: "example.custom.source", name: "Custom Source", localizedNames: { "zh-CN": "自定义来源" } };
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = { items: [] };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "multi-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "test", user: { id: "admin", role: "admin" } };
    if (path.endsWith("/admin/plugins")) json = { items: [
      { pluginId: plugin.id, plugin, supportsMultipleInstances: true, instances: [instanceIds.netease, instanceIds.neteaseSecond]
        .map(instanceId => ({ instanceId, name: instanceId, runtimeState: "ready" })) },
      { pluginId: ncmPlugin.id, plugin: ncmPlugin, supportsMultipleInstances: false,
        instances: [{ instanceId: instanceIds.ncm, name: "Ignored config alias", runtimeState: "ready" }] },
    ] };
    if (path.endsWith("/online-instances")) json = { items: [
      { instanceId: instanceIds.netease, plugin, platform: "custom", name: bound ? "Alice" : plugin.name,
        accountId: bound ? "account-a" : undefined, availability: bound ? "available" : "loginRequired", capabilities: [] },
      { instanceId: instanceIds.neteaseSecond, plugin, platform: "custom", name: "Bob",
        accountId: "account-b", availability: "available", capabilities: [] },
      { instanceId: instanceIds.ncm, name: "Never use a single-instance username", accountId: "wrong", capabilities: [] },
    ] };
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = page.locator(".settings-card").filter({ has: page.getByRole("heading", { name: "插件状态" }) });
  await expect(card.getByText("自定义来源 · Alice", { exact: true })).toBeVisible();
  await expect(card.getByText("自定义来源 · Bob", { exact: true })).toBeVisible();
  await expect(card.getByText("NCM 解密", { exact: true })).toBeVisible();
  await expect(card.getByText(/Ignored config|Never use|ab4dfbab|87d29d7b/)).toHaveCount(0);
  bound = false;
  await card.getByRole("button", { name: "刷新插件状态" }).click();
  await expect(card.getByText("自定义来源", { exact: true })).toBeVisible();
  await expect(card.getByText("自定义来源 · Alice", { exact: true })).toHaveCount(0);
});
