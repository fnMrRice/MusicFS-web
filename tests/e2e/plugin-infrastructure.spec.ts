import { expect, test, type Locator, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import type { ManagedPlugin, PluginDSP } from "../../src/api/directories";
import { localPlugin } from "../fixtures/plugins";

test.use({ locale: "zh-CN" });

let server: PreviewServer;
const origin = "http://127.0.0.1:18150";
const database: ManagedPlugin = {
  pluginId: "musicfs.plugin.storage.sqlite",
  plugin: { id: "musicfs.plugin.storage.sqlite", name: "SQLite", localizedNames: {}, features: ["database"] },
  version: "1.0.0", supportsMultipleInstances: false, instances: [], required: true, stateMutable: false,
  storage: { backend: "sqlite", mode: "builtin", runtimeState: "ready" },
};
const gain: ManagedPlugin = {
  pluginId: "musicfs.dsp.gain",
  plugin: { id: "musicfs.dsp.gain", name: "PCM Gain", localizedNames: { "zh-CN": "PCM 增益" }, features: ["audio-dsp"] },
  version: "1.0.0", supportsMultipleInstances: false, instances: [], required: false, stateMutable: false,
  dsp: { configured: false, chainState: "not_configured", nodes: [] },
};
const legacy = { pluginId: localPlugin.id, plugin: localPlugin, version: "1.0.0", supportsMultipleInstances: false, instances: [] };

test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 18150, strictPort: true } });
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

async function openPlugins(page: Page, items: unknown[]) {
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "infrastructure-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "test", user: { id: "admin", role: "admin" } };
    if (path.endsWith("/admin/plugins")) json = { items };
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/settings?tab=plugins`);
  return page.locator(".settings-card.plugin-status");
}

function entry(card: Locator, id: string) {
  return card.locator(".plugin-entry").filter({ has: card.page().getByText(id, { exact: true }) });
}

test("builtin algorithms show configuration and purpose without fake instances", async ({ page }) => {
  const items: ManagedPlugin[] = [
    ["analysis.chromaprint", "音频分析", "audio-analysis", "audio-analysis", false],
    ["tags.flac", "FLAC 标签", "metadata", "tag-format", false],
    ["matching.standard", "录音匹配", "matching", "matching", true],
    ["transform.thumbnail", "封面缩略图", "metadata", "content-transform", true],
  ].map(([suffix, label, purpose, capability, configured]) => {
    const id = `musicfs.plugin.${suffix}`;
    return { pluginId: id, plugin: { id, name: String(label), localizedNames: {}, features: [String(purpose)] }, version: "0.1.0", supportsMultipleInstances: false,
      instances: [], stateMutable: false, execution: "builtin", builtin: { configured: Boolean(configured), capabilities: [String(capability)] } };
  });
  const card = await openPlugins(page, items);
  for (const plugin of items) {
    const item = entry(card, plugin.pluginId);
    await expect(item.locator("summary")).toContainText("服务端内置");
    await item.locator("summary").click();
    await expect(item).toContainText("不表示依赖工具已就绪或任务正在运行");
    await expect(item.locator(".plugin-properties")).toContainText(plugin.builtin?.configured ? "已配置" : "未配置");
    await expect(item.getByText("暂无插件实例。", { exact: true })).toHaveCount(0);
    await expect(item.getByRole("button")).toHaveCount(0);
  }
  await card.getByRole("group", { name: "插件类型", exact: true }).getByRole("checkbox", { name: "元数据", exact: true }).check();
  await expect(card.locator(".plugin-entry")).toHaveCount(2);
  await expect(entry(card, "musicfs.plugin.tags.flac")).toBeVisible();
  await expect(entry(card, "musicfs.plugin.transform.thumbnail")).toBeVisible();
});

test("database is required and read-only while empty DSP has a configuration state", async ({ page }, info) => {
  const card = await openPlugins(page, [database, gain, legacy]);
  const db = entry(card, database.pluginId);
  const dsp = entry(card, gain.pluginId);
  await expect(db.locator("summary")).toContainText("必需");
  await expect(dsp.locator("summary")).toContainText("未配置");
  await db.locator("summary").click();
  await dsp.locator("summary").click();
  await expect(db).toContainText("数据库为服务端必需组件，不能停用");
  await expect(db).toContainText("修改后需重启服务端");
  await expect(db.locator(".plugin-properties")).toContainText("sqlite");
  await expect(db.locator(".plugin-properties")).toContainText("服务端内置");
  await expect(db.locator(".plugin-properties")).toContainText("可用");
  await expect(dsp).toContainText("此 DSP 尚未加入处理链。");
  await expect(dsp).toContainText("不表示当前歌曲正在执行这些处理");
  for (const item of [db, dsp]) {
    await expect(item.getByText("暂无插件实例。", { exact: true })).toHaveCount(0);
    await expect(item.getByRole("button")).toHaveCount(0);
    await expect(item.getByRole("switch")).toHaveCount(0);
    await expect(item.getByRole("checkbox")).toHaveCount(0);
  }
  const old = entry(card, legacy.pluginId);
  await old.locator("summary").click();
  await expect(old.getByText("暂无插件实例。", { exact: true })).toBeVisible();
  await expect(old.locator(".plugin-infrastructure")).toHaveCount(0);
  await old.locator("summary").click();
  await page.setViewportSize({ width: 1200, height: 1400 });
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("infrastructure-desktop.png"), fullPage: true });
});

test("database and DSP types participate in the existing multi-select filter", async ({ page }) => {
  const card = await openPlugins(page, [database, gain, legacy]);
  const types = card.getByRole("group", { name: "插件类型", exact: true });
  const dbType = types.getByRole("checkbox", { name: "数据库", exact: true });
  const dspType = types.getByRole("checkbox", { name: "DSP", exact: true });
  await dbType.check();
  await expect(card.locator(".plugin-entry")).toHaveCount(1);
  await expect(entry(card, database.pluginId)).toBeVisible();
  await dspType.check();
  await expect(card.locator(".plugin-entry")).toHaveCount(2);
  await expect(entry(card, gain.pluginId)).toBeVisible();
  await dbType.uncheck();
  await expect(card.locator(".plugin-entry")).toHaveCount(1);
  await card.getByRole("button", { name: "全部", exact: true }).click();
  await expect(card.locator(".plugin-entry")).toHaveCount(3);
});

test("configured DSP outside the chain is distinct from an unconfigured DSP", async ({ page }) => {
  const configured = { ...gain, dsp: { configured: true, chainState: "not_in_chain", nodes: [] } };
  const card = await openPlugins(page, [configured]);
  const dsp = entry(card, gain.pluginId);
  await expect(dsp.locator("summary")).toContainText("已配置，未入链");
  await expect(dsp.locator("summary")).not.toContainText("未配置");
  await dsp.locator("summary").click();
  await expect(dsp.getByRole("list")).toHaveCount(0);
  await expect(dsp).toContainText("此 DSP 尚未加入处理链。");
});

test("DSP preserves repeated nodes and full-chain positions with parameters and modes", async ({ page }, info) => {
  const dsp: PluginDSP = { configured: true, chainState: "in_chain", nodes: [
    { position: 5, name: "musicfs.dsp.gain", version: 1, params: {}, mode: "process" },
    { position: 1, name: "gain", version: 1, params: { gainDB: -3 }, mode: "builtin" },
    { position: 3, name: "musicfs.dsp.gain", version: 1, params: { gainDB: 1.5 }, mode: "process" },
  ] };
  const card = await openPlugins(page, [{ ...gain, dsp }]);
  const item = entry(card, gain.pluginId);
  await expect(item.locator("summary")).toContainText("已加入处理链");
  await item.locator("summary").click();
  const nodes = item.getByRole("list", { name: "处理链节点顺序", exact: true }).locator(":scope > li");
  await expect(nodes).toHaveCount(3);
  for (const [index, position] of [1, 3, 5].entries()) {
    await expect(nodes.nth(index)).toHaveAttribute("value", String(position));
    await expect(nodes.nth(index).getByText(index === 0 ? "gain" : "musicfs.dsp.gain", { exact: true })).toBeVisible();
  }
  await expect(nodes.nth(0)).toContainText("服务端内置");
  await expect(nodes.nth(0)).toContainText("gainDB");
  await expect(nodes.nth(0)).toContainText("-3");
  await expect(nodes.nth(1)).toContainText("独立进程");
  await expect(nodes.nth(1)).toContainText("1.5");
  await expect(nodes.nth(2)).toContainText("无参数");
  await expect(nodes.nth(2).locator(".plugin-properties > div").first()).toContainText("1");
  await expect(item.getByRole("button")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 1700 });
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("infrastructure-dsp-mobile.png"), fullPage: true });
});

test("external database identity and health come from its payload", async ({ page }) => {
  const plugin = { id: "example.database.custom", name: "Custom Database", localizedNames: { "zh-CN": "自定义数据库" }, features: ["database"] };
  const card = await openPlugins(page, [{ ...database, pluginId: plugin.id, plugin, version: "4.3.2",
    storage: { backend: "plugin", mode: "process", runtimeState: "unavailable" } }]);
  const db = entry(card, plugin.id);
  await expect(db.locator("summary")).toContainText("自定义数据库");
  await expect(db.locator("summary")).toContainText("4.3.2");
  await db.locator("summary").click();
  await expect(db.locator(".plugin-properties")).toContainText("plugin");
  await expect(db.locator(".plugin-properties")).toContainText("独立进程");
  await expect(db.locator(".plugin-properties")).toContainText("不可用");
  await expect(db.getByRole("button")).toHaveCount(0);
});

test("infrastructure labels and guidance follow the English language preference", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("musicfs:language", "en"));
  const card = await openPlugins(page, [{ ...database, storage: { ...database.storage, runtimeState: "unknown" } }, gain]);
  const db = entry(card, database.pluginId);
  const dsp = entry(card, gain.pluginId);
  await expect(db.locator("summary")).toContainText("Required");
  await expect(db.locator("summary")).toContainText("Database");
  await expect(dsp.locator("summary")).toContainText("Not configured");
  await db.locator("summary").click();
  await dsp.locator("summary").click();
  await expect(db).toContainText("cannot be disabled");
  await expect(db.locator(".plugin-properties")).toContainText("Unknown");
  await expect(db.locator(".plugin-properties")).toContainText("Built into server");
  await expect(dsp).toContainText("not the processing currently applied to a song");
  await expect(dsp).toContainText("Configuration changes require a server restart");
  await expect(dsp).toContainText("This DSP is not in the processing chain.");
  await expect(card.getByRole("group", { name: "Plugin types", exact: true }).getByRole("checkbox", { name: "Database", exact: true })).toBeVisible();
});
