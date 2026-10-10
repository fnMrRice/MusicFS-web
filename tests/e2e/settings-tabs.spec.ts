import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";

let server: PreviewServer;
const origin = "http://127.0.0.1:18145";
const tabNames = ["音乐源", "插件管理", "播放配置", "其他配置"];
const processingLabel = "服务端处理（降低 6 dB，下一首生效）";
const local = {
  id: "local", name: "Fixture library", availability: "available", capabilities: [],
  plugin: { id: "musicfs.localfiles", name: "Local files", localizedNames: { "zh-CN": "本地音乐" }, features: ["music-source"] },
};

test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 18145, strictPort: true } });
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

async function mock(page: Page, role = "admin") {
  const requests: string[] = [];
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: "1" };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "settings-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "listener", role } };
    if (path.endsWith("/provider-instances")) json = { items: [local] };
    if (path.endsWith("/admin/plugins")) json = { items: [{
      pluginId: "musicfs.localfiles", instances: [{ instanceId: "local", name: "Local library", runtimeState: "ready" }],
    }] };
    if (path.endsWith("/configuration")) json = {
      revision: "fixture-revision", roots: [],
      importOptions: { importDefaults: { recursive: true, maxDepth: 0, excludePatterns: [] } },
    };
    if (path.endsWith("/directories")) json = {
      revision: "fixture-revision", path: null, parentPath: null, configuredRootId: null, items: [], nextCursor: null,
    };
    return route.fulfill({ json });
  });
  return requests;
}

test("settings group existing controls and preserve playback preferences across tabs and refresh", async ({ page }, info) => {
  await mock(page);
  await page.goto(`${origin}/#/settings`);
  const tabs = page.getByRole("tablist", { name: "设置分类", exact: true });
  await expect(tabs.getByRole("tab")).toHaveText(tabNames);
  await expect(tabs.getByRole("tab", { name: "音乐源", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "本地音乐", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "插件状态", exact: true })).toHaveCount(0);
  await expect(page.getByLabel(processingLabel)).toHaveCount(0);
  await expect(page.locator(".language-select select")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("settings-sources-desktop.png") });

  await tabs.getByRole("tab", { name: "插件管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "插件状态", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "本地音乐", exact: true })).toHaveCount(0);
  await tabs.getByRole("tab", { name: "播放配置", exact: true }).click();
  await page.getByLabel(processingLabel).check();
  await page.getByRole("slider", { name: "默认音量", exact: true }).fill("0.42");
  await tabs.getByRole("tab", { name: "其他配置", exact: true }).click();
  await expect(page.locator(".language-select select")).toBeVisible();
  await expect(page.getByRole("heading", { name: "外观", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "连接与账号", exact: true })).toBeVisible();
  await expect(page.getByLabel(processingLabel)).toHaveCount(0);

  await tabs.getByRole("tab", { name: "播放配置", exact: true }).click();
  await page.reload();
  await expect(page).toHaveURL(/\/settings\?tab=playback$/);
  await expect(page.getByLabel(processingLabel)).toBeChecked();
  await expect(page.getByRole("slider", { name: "默认音量", exact: true })).toHaveValue("0.42");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of await tabs.getByRole("tab").all()) await expect(tab).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("settings-playback-mobile.png") });
});

test("tab navigation replaces history and unknown tab URLs fall back to music sources", async ({ page }) => {
  await mock(page);
  await page.goto(`${origin}/#/library`);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("tab", { name: "播放配置", exact: true }).click();
  await page.getByRole("tab", { name: "其他配置", exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/library$/);
  await page.goto(`${origin}/#/settings?tab=unknown&from=fixture`);
  await expect(page.getByRole("tab", { name: "音乐源", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "本地音乐", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "其他配置", exact: true }).click();
  await expect(page).toHaveURL(/tab=other&from=fixture$/);
});

test("keyboard navigation moves a single focus stop and only activates tabs on Enter or Space", async ({ page }) => {
  const requests = await mock(page);
  await page.goto(`${origin}/#/settings?tab=playback`);
  const playback = page.getByRole("tab", { name: "播放配置", exact: true });
  const sources = page.getByRole("tab", { name: "音乐源", exact: true });
  const plugins = page.getByRole("tab", { name: "插件管理", exact: true });
  const other = page.getByRole("tab", { name: "其他配置", exact: true });
  await playback.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(plugins).toBeFocused();
  await expect(plugins).toHaveAttribute("tabindex", "0");
  await expect(playback).toHaveAttribute("tabindex", "-1");
  await expect(playback).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(sources).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(other).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(sources).toBeFocused();
  await page.keyboard.press("End");
  await expect(other).toBeFocused();
  await expect(playback).toHaveAttribute("aria-selected", "true");
  expect(requests.filter((path) => path.endsWith("/admin/plugins"))).toEqual([]);
  await page.keyboard.press("Space");
  await expect(other).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "其他配置", exact: true })).toBeVisible();
  await expect(page.getByRole("tabpanel")).toHaveAttribute("id", (await other.getAttribute("aria-controls"))!);
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(sources).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "本地音乐", exact: true })).toBeVisible();
});

test("regular users retain all tabs and see plugin permissions without admin requests", async ({ page }) => {
  const requests = await mock(page, "user");
  await page.goto(`${origin}/#/settings?tab=plugins`);
  await expect(page.getByRole("tab")).toHaveText(tabNames);
  await expect(page.getByText("插件管理仅对管理员开放。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新插件状态", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "音乐源", exact: true }).click();
  await expect(page.getByRole("heading", { name: "本地音乐", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(管理目录|管理音乐目录)$/ })).toHaveCount(0);
  expect(requests.filter((path) => path.includes("/admin/"))).toEqual([]);
});

test("legacy directory links open music sources and dismiss before switching tabs", async ({ page }) => {
  await mock(page);
  await page.goto(`${origin}/#/settings?tab=plugins&directories=local`);
  await expect(page.getByRole("tab", { name: "音乐源", exact: true })).toHaveAttribute("aria-selected", "true");
  const directories = page.getByRole("list", { name: "已选音乐目录", exact: true });
  await expect(directories).toHaveCount(1);
  await page.getByRole("button", { name: /^(取消|收起目录管理)$/ }).click();
  await expect(directories).toHaveCount(0);
  await page.getByRole("tab", { name: "播放配置", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\?tab=playback$/);
  await page.reload();
  await expect(page.getByLabel(processingLabel)).toBeVisible();
  await expect(directories).toHaveCount(0);
});

test("leaving music sources cancels inline authorization and returning does not resume its polling", async ({ page }) => {
  await mock(page);
  await page.clock.install();
  const actions: { action: string; loginId: string }[] = [];
  let account: Record<string, unknown> = { state: "signedOut" };
  await page.route("**/api/v1/online-instances", (route) => route.fulfill({ json: { items: [{
    instanceId: "qq", name: "QQ fixture", platform: "qqmusic", availability: "loginRequired", capabilities: [],
    plugin: { id: "musicfs.qqmusic", name: "QQ Music", localizedNames: { "zh-CN": "QQ音乐" }, features: ["music-source"] },
  }] } }));
  await page.route("**/api/v1/online-instances/qq/account/options", (route) => route.fulfill({ json: { method: "qr", configured: true } }));
  await page.route("**/api/v1/online-instances/qq/account", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { action: string; loginId: string };
      actions.push(body);
      if (body.action === "begin") account = { state: "waiting", method: "qr", loginId: "qq-challenge", qrUrl: "https://example.test/qr", pollAfterSeconds: 3 };
      if (body.action === "cancel") account = { state: "signedOut" };
    }
    return route.fulfill({ json: account });
  });
  await page.goto(`${origin}/#/settings`);
  await page.getByRole("button", { name: "登录QQ音乐", exact: true }).click();
  await expect(page.getByText("等待授权", { exact: true })).toBeVisible();
  await expect(page.getByAltText("QQ音乐登录二维码", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "音乐源", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("等待授权", { exact: true })).toBeVisible();
  expect(actions.map(({ action }) => action)).toEqual(["begin"]);
  await page.keyboard.press("Enter");
  await expect.poll(() => actions.filter(({ action }) => action === "cancel").map(({ loginId }) => loginId)).toEqual(["qq-challenge"]);
  await page.clock.runFor(4000);
  expect(actions.some(({ action }) => action === "poll")).toBe(false);
  await page.getByRole("tab", { name: "音乐源", exact: true }).click();
  await expect(page.getByRole("button", { name: "登录QQ音乐", exact: true })).toBeEnabled();
  await expect(page.getByAltText("QQ音乐登录二维码", { exact: true })).toHaveCount(0);
  await page.clock.runFor(4000);
  expect(actions.map(({ action }) => action)).toEqual(["begin", "cancel"]);
});
