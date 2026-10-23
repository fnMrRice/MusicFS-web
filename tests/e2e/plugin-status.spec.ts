import { test, expect, type Locator, type Page } from "@playwright/test";
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

async function mockPlugins(page: Page, snapshot: (url: URL) => unknown, online: () => unknown[] = () => []) {
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "plugin-status-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "test", user: { id: "admin", role: "admin" } };
    if (path.endsWith("/admin/plugins")) json = snapshot(url);
    if (path.endsWith("/online-instances")) json = { items: online() };
    if (path.endsWith("/configuration")) json = { revision: "test", roots: [] };
    if (path.endsWith("/root-statistics")) json = { roots: [] };
    if (path.endsWith("/scan-status")) json = { job: null };
    return route.fulfill({ json });
  });
}

function pluginCard(page: Page) {
  return page.locator(".settings-card").filter({ has: page.locator(".plugin-status-heading") });
}

function pluginEntry(card: Locator, pluginId: string) {
  return card.locator(".plugin-entry").filter({ has: card.page().getByText(pluginId, { exact: true }) });
}

async function expectRefreshBesideSearch(card: Locator, label = "刷新插件列表", text = "刷新") {
  const search = card.locator(".plugin-status-heading").getByRole("searchbox");
  const refresh = card.locator(".plugin-status-heading").getByRole("button", { name: label, exact: true });
  await expect(refresh).toBeVisible();
  await expect(refresh).toHaveText(text);
  await expect(card.locator(".plugin-status-heading h3")).toHaveCount(0);
  const searchBox = await search.boundingBox();
  const buttonBox = await refresh.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.x).toBeGreaterThanOrEqual(searchBox!.x + searchBox!.width);
  expect(Math.abs(buttonBox!.y + buttonBox!.height / 2 - searchBox!.y - searchBox!.height / 2)).toBeLessThan(8);
}

test("plugin groups show identity, separate rows and expandable instances with refresh beside the search", async ({ page }, info) => {
  let localState = "pending_configuration";
  let allowedDirectories = 4;
  await mockPlugins(page, () => ({ items: [
    { pluginId: localPlugin.id, plugin: localPlugin, version: "1.2.3", supportsMultipleInstances: false,
      displayCount: { value: allowedDirectories, unit: "allowed directories", localizedUnits: { "zh-CN": "个允许访问的目录" } },
      instances: [{ instanceId: instanceIds.local, name: "Local test", runtimeState: localState }] },
    { pluginId: ncmPlugin.id, plugin: ncmPlugin, version: "2.0.1", supportsMultipleInstances: false,
      instances: [{ instanceId: instanceIds.ncm, name: "NCM test", runtimeState: "disabled" }] },
    { pluginId: scraperPlugin.id, plugin: scraperPlugin, version: "3.0.0", supportsMultipleInstances: false,
      instances: [{ instanceId: instanceIds.scraper, name: "Scraper test", runtimeState: "ready" }] },
  ] }));
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = pluginCard(page);
  const local = pluginEntry(card, localPlugin.id);
  const ncm = pluginEntry(card, ncmPlugin.id);
  const scraper = pluginEntry(card, scraperPlugin.id);
  await expect(card.locator(".plugin-entry")).toHaveCount(3);
  for (const [entry, id, name, version] of [
    [local, localPlugin.id, "本地音乐", "1.2.3"],
    [ncm, ncmPlugin.id, "NCM 解密", "2.0.1"],
    [scraper, scraperPlugin.id, "本地元数据提取", "3.0.0"],
  ] as const) {
    const summary = entry.locator("summary");
    await expect(summary.getByText(name, { exact: true })).toBeVisible();
    await expect(summary.getByText(id, { exact: true })).toBeVisible();
    await expect(summary).toContainText(version);
    await expect(summary).not.toContainText("个实例");
    await expect(entry).not.toHaveAttribute("open");
    await expect(entry.locator(".plugin-instance")).toBeHidden();
  }
  await expect(local.locator(".plugin-count")).toHaveText("4 个允许访问的目录");
  await expect(ncm.locator(".plugin-count")).toHaveCount(0);
  await expect(scraper.locator(".plugin-count")).toHaveCount(0);
  await expectRefreshBesideSearch(card);
  expect(await card.locator(".plugin-entry").evaluateAll(entries => entries.slice(1).every((entry, index) =>
    parseFloat(getComputedStyle(entry).borderTopWidth) > 0 ||
    parseFloat(getComputedStyle(entries[index]!).borderBottomWidth) > 0,
  ))).toBe(true);

  await local.locator("summary").click();
  await ncm.locator("summary").click();
  await scraper.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(scraper).toHaveAttribute("open");
  await expect(card.getByText("待配置", { exact: true })).toBeVisible();
  await expect(card.getByText("已禁用", { exact: true })).toBeVisible();
  await expect(card.getByText("请从允许访问的目录中选择音乐目录。")).toBeVisible();
  await expect(local.getByRole("link", { name: "管理音乐目录", exact: true }))
    .toHaveAttribute("href", `#/settings?directories=${instanceIds.local}`);
  await expect(card.getByText(/Local test|NCM test|Scraper test/)).toHaveCount(0);
  await expect(card.getByText(instanceIds.local, { exact: false })).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(scraper).not.toHaveAttribute("open");
  await expect(scraper.locator(".plugin-instance")).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(scraper.locator(".plugin-instance")).toBeVisible();
  await ncm.locator("summary").click();
  await expect(ncm).not.toHaveAttribute("open");
  localState = "ready";
  allowedDirectories = 2;
  await card.getByRole("button", { name: "刷新插件列表" }).click();
  await expect(local.locator(".plugin-count")).toHaveText("2 个允许访问的目录");
  await expect(local.getByText("可用", { exact: true })).toBeVisible();
  await expect(scraper.getByText("可用", { exact: true })).toBeVisible();
  await expect(local).toHaveAttribute("open");
  await expect(scraper).toHaveAttribute("open");
  await expect(ncm).not.toHaveAttribute("open");
  await expect(card.getByText("待配置", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("plugin-management-desktop.png"), fullPage: true });
});

test("settings show restart-required disable while the plugin remains available", async ({ page }) => {
  let restartRequired = true;
  await mockPlugins(page, () => ({ restartRequired, items: [
    { pluginId: ncmPlugin.id, plugin: ncmPlugin, version: "2.0.1", supportsMultipleInstances: false,
      instances: [{ instanceId: instanceIds.ncm, name: "NCM test", runtimeState: restartRequired ? "ready" : "disabled",
        reason: restartRequired ? "RESTART_REQUIRED" : null }] },
  ] }));
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = pluginCard(page);
  const entry = pluginEntry(card, ncmPlugin.id);
  await expect(card.getByText("配置变更需要重启服务端后生效。", { exact: true })).toBeVisible();
  await entry.locator("summary").click();
  await expect(card.getByText("等待重启后停用。", { exact: true })).toBeVisible();
  await expect(card.getByText("可用", { exact: true })).toBeVisible();
  await expect(card.getByText("已禁用", { exact: true })).toHaveCount(0);
  restartRequired = false;
  await card.getByRole("button", { name: "刷新插件列表" }).click();
  await expect(card.getByText("已禁用", { exact: true })).toBeVisible();
  await expect(card.getByText("配置变更需要重启服务端后生效。", { exact: true })).toHaveCount(0);
  await expect(card.getByText("等待重启后停用。", { exact: true })).toHaveCount(0);
  await expect(entry).toHaveAttribute("open");
});

test("plugin-provided user counts and account names refresh after logout", async ({ page }) => {
  let bound = true;
  const plugin = { ...neteasePlugin, id: "example.custom.source", name: "Custom Source", localizedNames: { "zh-CN": "自定义来源" } };
  await mockPlugins(page, () => ({ items: [
    { pluginId: plugin.id, plugin, version: "4.2.0", supportsMultipleInstances: true,
      displayCount: { value: bound ? 2 : 1, unit: "users", localizedUnits: { "zh-CN": "个用户" } },
      instances: [instanceIds.netease, instanceIds.neteaseSecond]
        .map(instanceId => ({ instanceId, name: instanceId, runtimeState: "ready" })) },
    { pluginId: ncmPlugin.id, plugin: ncmPlugin, version: "2.0.1", supportsMultipleInstances: false,
      instances: [{ instanceId: instanceIds.ncm, name: "Ignored config alias", runtimeState: "ready" }] },
  ] }), () => [
    { instanceId: instanceIds.netease, plugin, platform: "custom", name: bound ? "Alice" : plugin.name,
      accountId: bound ? "account-a" : undefined, availability: bound ? "available" : "loginRequired", capabilities: [] },
    { instanceId: instanceIds.neteaseSecond, plugin, platform: "custom", name: "Bob",
      accountId: "account-b", availability: "available", capabilities: [] },
    { instanceId: instanceIds.ncm, name: "Never use a single-instance username", accountId: "wrong", capabilities: [] },
  ]);
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = pluginCard(page);
  const entry = pluginEntry(card, plugin.id);
  await expect(entry).toHaveCount(1);
  await expect(entry.locator(".plugin-count")).toHaveText("2 个用户");
  await entry.locator("summary").click();
  const instances = entry.locator(".plugin-instance");
  await expect(instances).toHaveCount(2);
  await expect(instances.nth(0).getByText("自定义来源 · Alice", { exact: true })).toBeVisible();
  await expect(instances.nth(1).getByText("自定义来源 · Bob", { exact: true })).toBeVisible();
  const ncm = pluginEntry(card, ncmPlugin.id);
  await ncm.locator("summary").click();
  await expect(ncm.locator(".plugin-instance").getByText("NCM 解密", { exact: true })).toBeVisible();
  await expect(card.getByText(/Ignored config|Never use|ab4dfbab|87d29d7b/)).toHaveCount(0);
  bound = false;
  await card.getByRole("button", { name: "刷新插件列表" }).click();
  await expect(entry.locator(".plugin-count")).toHaveText("1 个用户");
  await expect(instances).toHaveCount(2);
  await expect(instances.nth(0).getByText("自定义来源", { exact: true })).toBeVisible();
  await expect(instances.nth(1).getByText("自定义来源 · Bob", { exact: true })).toBeVisible();
  await expect(card.getByText("自定义来源 · Alice", { exact: true })).toHaveCount(0);
  await expect(entry).toHaveAttribute("open");
});

test("admins opt into all user instances and return to their own instances without merging accounts", async ({ page }) => {
  const scopes: (string | null)[] = [];
  const plugin = { ...neteasePlugin, id: "example.account.source", name: "Account Source",
    localizedNames: { "zh-CN": "账号来源" } };
  const instances = [
    { instanceId: instanceIds.netease, name: instanceIds.netease, ownerUserId: "admin", runtimeState: "ready" },
    { instanceId: instanceIds.neteaseSecond, name: instanceIds.neteaseSecond, ownerUserId: "listener-b",
      accountName: "Bob", runtimeState: "ready" },
  ];
  await mockPlugins(page, url => {
    scopes.push(url.searchParams.get("allUsers"));
    return { items: [{ pluginId: plugin.id, plugin, version: "4.2.0", supportsMultipleInstances: true,
      displayCount: { value: url.searchParams.get("allUsers") === "true" ? 2 : 1,
        unit: "users", localizedUnits: { "zh-CN": "个用户" } },
      instances: url.searchParams.get("allUsers") === "true" ? instances : instances.slice(0, 1) }] };
  }, () => [
    { instanceId: instanceIds.netease, plugin, name: "Alice", accountId: "account-a", capabilities: [] },
  ]);
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = pluginCard(page);
  const allUsers = card.getByRole("checkbox", { name: "显示所有用户实例", exact: true });
  const entry = pluginEntry(card, plugin.id);
  await expect(allUsers).not.toBeChecked();
  await expect(entry.locator(".plugin-count")).toHaveText("1 个用户");
  expect(scopes).toEqual([null, null]);
  await entry.locator("summary").click();
  await expect(entry.locator(".plugin-instance")).toHaveCount(1);
  await expect(entry.getByText("账号来源 · Alice", { exact: true })).toBeVisible();
  await expect(entry.getByText("账号来源 · Bob", { exact: true })).toHaveCount(0);

  await allUsers.check();
  await expect(entry.locator(".plugin-count")).toHaveText("2 个用户");
  await expect(entry.locator(".plugin-instance")).toHaveCount(2);
  const alice = entry.locator(".plugin-instance").filter({ hasText: "账号来源 · Alice" });
  const bob = entry.locator(".plugin-instance").filter({ hasText: "账号来源 · Bob" });
  await expect(alice).toBeVisible();
  await expect(alice).toContainText("admin");
  await expect(bob).toBeVisible();
  await expect(bob).toContainText("listener-b");
  expect(scopes).toEqual([null, null, "true"]);

  await allUsers.uncheck();
  await expect(entry.locator(".plugin-count")).toHaveText("1 个用户");
  await expect(entry.locator(".plugin-instance")).toHaveCount(1);
  await expect(entry.getByText("账号来源 · Alice", { exact: true })).toBeVisible();
  await expect(entry.getByText("账号来源 · Bob", { exact: true })).toHaveCount(0);
  expect(scopes).toEqual([null, null, "true", null]);
});

test("missing counts stay hidden and plugins can provide zero with arbitrary units", async ({ page }) => {
  const custom = { ...scraperPlugin, id: "example.custom.catalog", name: "Custom Catalog", localizedNames: {} };
  await mockPlugins(page, () => ({ items: [
    { pluginId: localPlugin.id, plugin: localPlugin, supportsMultipleInstances: false, instances: [] },
    { pluginId: custom.id, plugin: custom, supportsMultipleInstances: false,
      displayCount: { value: 0, unit: "indexes", localizedUnits: { "zh-CN": "项索引" } },
      instances: [{ instanceId: instanceIds.custom, ownerUserId: "listener-a", runtimeState: "ready" }] },
  ] }));
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = pluginCard(page);
  const entry = pluginEntry(card, localPlugin.id);
  await expect(entry.locator("summary").getByText("本地音乐", { exact: true })).toBeVisible();
  await expect(entry.locator("summary").getByText(localPlugin.id, { exact: true })).toBeVisible();
  await expect(entry.locator("summary")).toContainText("未知版本");
  await expect(entry.locator(".plugin-count")).toHaveCount(0);
  await expect(pluginEntry(card, custom.id).locator(".plugin-count")).toHaveText("0 项索引");
  await entry.locator("summary").click();
  await expect(entry).toHaveAttribute("open");
  await expect(entry.locator(".plugin-instance")).toHaveCount(0);
  await expect(card.getByText("未发现已安装插件。", { exact: true })).toHaveCount(0);
});

test("malformed plugin counts never become instance-count fallbacks", async ({ page }) => {
  const invalidCounts = [
    null,
    { value: -1, unit: "users" },
    { value: 1.5, unit: "users" },
    { value: "2", unit: "users" },
    { value: 2, unit: " " },
    { value: 2 },
  ];
  await mockPlugins(page, () => ({ items: invalidCounts.map((displayCount, index) => {
    const plugin = { ...neteasePlugin, id: `example.invalid.${index}` };
    return { pluginId: plugin.id, plugin, displayCount, supportsMultipleInstances: true,
      instances: [{ instanceId: instanceIds.netease, ownerUserId: "admin", runtimeState: "ready" }] };
  }) }));
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = pluginCard(page);
  await expect(card.locator(".plugin-entry")).toHaveCount(invalidCounts.length);
  await expect(card.locator(".plugin-count")).toHaveCount(0);
});

for (const [locale, name, version, refresh, refreshText, count] of [
  ["en", "Local Music", "Unknown version", "Refresh plugin list", "Refresh", "3 sources"],
  ["zh-TW", "本地音樂", "未知版本", "重新整理外掛程式清單", "重新整理", "3 個來源"],
  ["ja", "Local Music", "不明なバージョン", "プラグイン一覧を更新", "更新", "3 sources"],
] as const) {
  test(`plugin group labels and controls follow the ${locale} language preference`, async ({ page }) => {
    await page.addInitScript(language => localStorage.setItem("musicfs:language", language), locale);
    await mockPlugins(page, () => ({ items: [
      { pluginId: localPlugin.id, plugin: localPlugin, supportsMultipleInstances: false, instances: [],
        displayCount: { value: 3, unit: "sources", localizedUnits: { "zh_Hant": "個來源", "zh-CN": "个来源" } } },
    ] }));
    await page.goto(`${origin}/#/settings?tab=plugins`);
    const card = pluginCard(page);
    await expectRefreshBesideSearch(card, refresh, refreshText);
    await expect(card.locator("summary").getByText(name, { exact: true })).toBeVisible();
    await expect(card.locator("summary")).toContainText(version);
    await expect(card.locator(".plugin-count")).toHaveText(count);
    await expect(card.locator("summary").getByText(localPlugin.id, { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: refresh, exact: true })).toBeVisible();
  });
}

test("mobile plugin groups wrap long identifiers without horizontal overflow", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const plugin = { ...neteasePlugin, id: `example.plugin.source.${"verylongidentifier".repeat(8)}`,
    name: "An extended provider name", localizedNames: { "zh-CN": "提供多个用户独立账号的音乐来源插件" } };
  await mockPlugins(page, () => ({ items: [
    { pluginId: plugin.id, plugin, version: "2026.10.20-preview.1234567890", supportsMultipleInstances: true,
      displayCount: { value: 2, unit: "users", localizedUnits: { "zh-CN": "个用户" } },
      instances: [instanceIds.netease, instanceIds.neteaseSecond]
        .map(instanceId => ({ instanceId, name: instanceId, runtimeState: "ready" })) },
    { pluginId: localPlugin.id, plugin: localPlugin, version: "1.2.3", supportsMultipleInstances: false, instances: [] },
  ] }), () => [
    { instanceId: instanceIds.netease, plugin, name: "Alice", accountId: "account-a", capabilities: [] },
    { instanceId: instanceIds.neteaseSecond, plugin, name: "Bob", accountId: "account-b", capabilities: [] },
  ]);
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = pluginCard(page);
  const entry = pluginEntry(card, plugin.id);
  await expect(entry.locator("summary").getByText(plugin.id, { exact: true })).toBeVisible();
  await expectRefreshBesideSearch(card);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await entry.locator("summary").click();
  await expect(entry.locator(".plugin-instance")).toHaveCount(2);
  await expect(entry.locator(".plugin-instance").nth(1)).toBeVisible();
  await page.screenshot({ path: info.outputPath("plugin-management-mobile.png"), fullPage: true });
  const cardWidth = await card.evaluate(element => ({
    scroll: element.scrollWidth, client: element.clientWidth,
    overflowing: [...element.querySelectorAll("*")].filter(child => child.scrollWidth > child.clientWidth)
      .map(child => ({ className: child.className, scroll: child.scrollWidth, client: child.clientWidth })),
  }));
  expect(cardWidth.scroll, JSON.stringify(cardWidth)).toBeLessThanOrEqual(cardWidth.client);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => localStorage.setItem("musicfs:language", "ja"));
  await page.reload();
  await expectRefreshBesideSearch(pluginCard(page), "プラグイン一覧を更新", "更新");
  expect(await pluginCard(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("an empty installed-plugin list keeps the refresh control available", async ({ page }) => {
  await mockPlugins(page, () => ({ items: [] }));
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const card = pluginCard(page);
  await expect(card.getByText("未发现已安装插件。", { exact: true })).toBeVisible();
  await expect(card.locator(".plugin-entry")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "刷新插件列表", exact: true })).toBeEnabled();
});
