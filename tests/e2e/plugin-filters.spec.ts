import { expect, test, type Locator, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { localPlugin, ncmPlugin, scraperPlugin } from "../fixtures/plugins";

test.use({ locale: "zh-CN" });

let server: PreviewServer;
const origin = "http://127.0.0.1:18149";
const longFeature = "a".repeat(64);
const plugins = [
  localPlugin,
  { ...ncmPlugin, features: ["audio-decryption"] },
  { ...scraperPlugin, features: ["lyrics", "artwork"] },
  { id: "example.hybrid.radio", name: "Hybrid Radio", localizedNames: {
    "zh-CN": "组合电台", "zh-TW": "複合電臺", ja: "複合ラジオ",
  }, features: ["music-source", "lyrics"] },
  { id: "example.processing", name: "Audio Processing", localizedNames: {}, features: ["audio-processing"] },
  { id: "example.custom", name: "Custom Function", localizedNames: {}, features: ["custom-feature", "constructor", longFeature] },
  { id: "example.unclassified", name: "Unclassified Plugin", localizedNames: {}, features: [] },
];
const entries = plugins.map(plugin => ({
  pluginId: plugin.id, plugin, version: "1.2.3", supportsMultipleInstances: false, instances: [],
}));

test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 18149, strictPort: true } });
});
test.afterAll(async () => {
  await new Promise<void>(resolve => server?.httpServer.close(() => resolve()));
});

async function openPlugins(page: Page, snapshot: () => unknown = () => ({ items: entries })) {
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "plugin-filter-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "test", user: { id: "admin", role: "admin" } };
    if (path.endsWith("/admin/plugins")) json = snapshot();
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/settings?tab=plugins`);
  return page.locator(".settings-card").filter({ has: page.locator(".plugin-status-heading") });
}

function entry(card: Locator, pluginId: string) {
  return card.locator(".plugin-entry").filter({ has: card.page().getByText(pluginId, { exact: true }) });
}

async function expectVisiblePlugins(card: Locator, ids: string[]) {
  await expect(card.locator(".plugin-entry")).toHaveCount(ids.length);
  for (const id of ids) await expect(entry(card, id)).toBeVisible();
}

test("plugin list shows purposes and versions with empty type selection displaying every plugin", async ({ page }) => {
  const card = await openPlugins(page);
  await expect(card.getByRole("heading", { name: "插件列表", exact: true })).toBeVisible();
  const types = card.getByRole("group", { name: "插件类型", exact: true });
  for (const label of ["音乐源", "音频解密", "歌词", "封面", "音频处理", "custom-feature", "constructor", longFeature, "未分类"]) {
    await expect(types.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
  }
  await expect(card.getByRole("searchbox", { name: "按 ID 或名称筛选插件", exact: true })).toHaveValue("");
  await expectVisiblePlugins(card, plugins.map(plugin => plugin.id));
  const purposes = [
    [localPlugin.id, ["音乐源"]], [ncmPlugin.id, ["音频解密"]],
    [scraperPlugin.id, ["歌词", "封面"]], ["example.hybrid.radio", ["音乐源", "歌词"]],
    ["example.processing", ["音频处理"]], ["example.custom", ["custom-feature", "constructor", longFeature]],
    ["example.unclassified", ["未分类"]],
  ] as const;
  for (const [id, labels] of purposes) {
    const summary = entry(card, id).locator("summary");
    await expect(summary).toContainText("1.2.3");
    for (const label of labels) await expect(summary.locator(".plugin-purposes").getByText(label, { exact: true })).toBeVisible();
  }
});

test("type filters accept multiple types as alternatives and return to all plugins when cleared", async ({ page }) => {
  const card = await openPlugins(page);
  const types = card.getByRole("group", { name: "插件类型", exact: true });
  const music = types.getByRole("checkbox", { name: "音乐源", exact: true });
  const lyrics = types.getByRole("checkbox", { name: "歌词", exact: true });
  await music.check();
  await expectVisiblePlugins(card, [localPlugin.id, "example.hybrid.radio"]);
  await lyrics.check();
  await expectVisiblePlugins(card, [localPlugin.id, scraperPlugin.id, "example.hybrid.radio"]);
  await music.uncheck();
  await expectVisiblePlugins(card, [scraperPlugin.id, "example.hybrid.radio"]);
  await lyrics.uncheck();
  await expectVisiblePlugins(card, plugins.map(plugin => plugin.id));

  await types.getByRole("checkbox", { name: "未分类", exact: true }).check();
  await expectVisiblePlugins(card, ["example.unclassified"]);
  await types.getByRole("checkbox", { name: "custom-feature", exact: true }).check();
  await expectVisiblePlugins(card, ["example.custom", "example.unclassified"]);
  await card.getByRole("button", { name: "全部", exact: true }).click();
  for (const checkbox of await types.getByRole("checkbox").all()) await expect(checkbox).not.toBeChecked();
  await expectVisiblePlugins(card, plugins.map(plugin => plugin.id));
});

test("search matches trimmed case-insensitive IDs and default or localized plugin names", async ({ page }) => {
  const card = await openPlugins(page);
  const search = card.getByRole("searchbox", { name: "按 ID 或名称筛选插件", exact: true });
  for (const [query, id] of [
    ["  SOURCE.LOCALFILES  ", localPlugin.id], ["  local MUSIC ", localPlugin.id],
    ["本地音乐", localPlugin.id], ["本地音樂", localPlugin.id],
    ["  HYBRID radio  ", "example.hybrid.radio"], ["複合電臺", "example.hybrid.radio"],
    ["複合ラジオ", "example.hybrid.radio"],
  ]) {
    await search.fill(query!);
    await expectVisiblePlugins(card, [id!]);
  }
  await search.fill("   ");
  await expectVisiblePlugins(card, plugins.map(plugin => plugin.id));
});

test("search combines with types and resetting types preserves the search query", async ({ page }) => {
  const card = await openPlugins(page);
  const search = card.getByRole("searchbox", { name: "按 ID 或名称筛选插件", exact: true });
  const types = card.getByRole("group", { name: "插件类型", exact: true });
  await types.getByRole("checkbox", { name: "音乐源", exact: true }).check();
  await search.fill("hybrid");
  await expectVisiblePlugins(card, ["example.hybrid.radio"]);
  await search.fill("NCM");
  await expectVisiblePlugins(card, []);
  await expect(card.getByText("没有符合筛选条件的插件。", { exact: true })).toBeVisible();
  await expect(card.getByText("未发现已安装插件。", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "刷新插件列表", exact: true })).toBeEnabled();
  await card.getByRole("button", { name: "全部", exact: true }).click();
  await expect(search).toHaveValue("NCM");
  await expectVisiblePlugins(card, [ncmPlugin.id]);
  await expect(card.getByText("没有符合筛选条件的插件。", { exact: true })).toHaveCount(0);
});

test("refresh keeps active filters while updating matching plugin data", async ({ page }) => {
  let version = "1.2.3";
  const card = await openPlugins(page, () => ({ items: entries.map(item => ({ ...item, version })) }));
  const search = card.getByRole("searchbox", { name: "按 ID 或名称筛选插件", exact: true });
  const music = card.getByRole("group", { name: "插件类型", exact: true }).getByRole("checkbox", { name: "音乐源", exact: true });
  await music.check();
  await search.fill("local");
  version = "2.0.0";
  await card.getByRole("button", { name: "刷新插件列表", exact: true }).click();
  await expectVisiblePlugins(card, [localPlugin.id]);
  await expect(entry(card, localPlugin.id).locator("summary")).toContainText("2.0.0");
  await expect(music).toBeChecked();
  await expect(search).toHaveValue("local");
});

for (const [locale, group, all, lyrics, artwork, searchLabel, empty] of [
  ["en", "Plugin types", "All", "Lyrics", "Artwork", "Filter plugins by ID or name", "No plugins match these filters."],
  ["zh-TW", "外掛程式類型", "全部", "歌詞", "封面", "依 ID 或名稱篩選外掛程式", "沒有符合篩選條件的外掛程式。"],
  ["ja", "プラグインの種類", "すべて", "歌詞", "カバーアート", "ID または名前でプラグインを絞り込み", "条件に一致するプラグインはありません。"],
] as const) {
  test(`plugin filter controls and purposes follow the ${locale} language preference`, async ({ page }) => {
    await page.addInitScript(language => localStorage.setItem("musicfs:language", language), locale);
    const card = await openPlugins(page);
    const types = card.getByRole("group", { name: group, exact: true });
    await expect(types.getByRole("button", { name: all, exact: true })).toBeVisible();
    await expect(types.getByRole("checkbox", { name: lyrics, exact: true })).toBeVisible();
    await expect(types.getByRole("checkbox", { name: artwork, exact: true })).toBeVisible();
    const purposes = entry(card, scraperPlugin.id).locator(".plugin-purposes");
    await expect(purposes.getByText(lyrics, { exact: true })).toBeVisible();
    await expect(purposes.getByText(artwork, { exact: true })).toBeVisible();
    await card.getByRole("searchbox", { name: searchLabel, exact: true }).fill("no-match");
    await expect(card.getByText(empty, { exact: true })).toBeVisible();
  });
}

test("plugin filters remain usable without horizontal overflow on narrow screens", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const card = await openPlugins(page);
  const types = card.getByRole("group", { name: "插件类型", exact: true });
  const search = card.getByRole("searchbox", { name: "按 ID 或名称筛选插件", exact: true });
  await types.getByRole("checkbox", { name: "音乐源", exact: true }).check();
  await types.getByRole("checkbox", { name: "歌词", exact: true }).check();
  await search.fill("hybrid");
  await expectVisiblePlugins(card, ["example.hybrid.radio"]);
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("plugin-filters-mobile.png"), fullPage: true });
});
