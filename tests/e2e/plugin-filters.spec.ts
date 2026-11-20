import { expect, test, type Locator, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { localPlugin, ncmPlugin, scraperPlugin } from "../fixtures/plugins";

test.use({ locale: "zh-CN" });

let server: PreviewServer;
const origin = "http://127.0.0.1:18149";
const longFeature = "a".repeat(64);
const plugins = [
  localPlugin,
  ncmPlugin,
  { id: "musicfs.plugin.decoder.ffmpeg", name: "FFmpeg Audio Codec", localizedNames: {
    "zh-CN": "FFmpeg 音频编解码",
  }, features: ["audio-codec"] },
  { id: "musicfs.plugin.decoder.channelmix", name: "Audio Channel Conversion", localizedNames: {
    "zh-CN": "音频声道转换",
  }, features: ["audio-dsp"] },
  scraperPlugin,
  { id: "example.hybrid.radio", name: "Hybrid Radio", localizedNames: {
    "zh-CN": "组合电台", "zh-TW": "複合電臺", ja: "複合ラジオ",
  }, features: ["music-source", "metadata"] },
  { id: "example.processing", name: "Audio Processing", localizedNames: {}, features: ["audio-processing"] },
  { id: "musicfs.plugin.content.asmr", name: "ASMR", localizedNames: {}, features: ["content-type"] },
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

test("scraper type and supported content come from the plugin declaration", async ({ page }) => {
  const plugin = { id: "example.remote", name: "Remote Metadata", localizedNames: {}, features: ["metadata", "scraper"] };
  const card = await openPlugins(page, () => ({ items: [...entries, { pluginId: plugin.id, plugin, builtin: {
    configured: true, capabilities: ["albumDetails", "albumTracks", "artistImage"],
  }, version: "1.0.0", instances: [] }] }));
  await card.getByRole("checkbox", { name: "刮削插件" }).check();
  await expectVisiblePlugins(card, [plugin.id]);
  const item = entry(card, plugin.id);
  await item.locator(".plugin-entry-toggle").click();
  for (const label of ["支持刮削的内容", "专辑详情", "专辑曲目", "歌手图像"])
    await expect(item.getByText(label)).toBeVisible();
});

async function expectVisiblePlugins(card: Locator, ids: string[]) {
  await expect(card.locator(".plugin-entry")).toHaveCount(ids.length);
  for (const id of ids) await expect(entry(card, id)).toBeVisible();
}

test("each plugin shows its version in the list and reveals its purposes when expanded", async ({ page }) => {
  const card = await openPlugins(page);
  await expect(card.getByRole("heading", { name: "插件列表", exact: true })).toHaveCount(0);
  const types = card.getByRole("group", { name: "插件类型", exact: true });
  for (const label of ["音乐源", "音频编解码", "DSP", "元数据", "音频处理", "内容类型", "custom-feature", "constructor", longFeature, "未分类"]) {
    await expect(types.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
  }
  await expect(card.getByRole("searchbox", { name: "按 ID 或名称筛选插件", exact: true })).toHaveValue("");
  await expectVisiblePlugins(card, plugins.map(plugin => plugin.id));
  const purposes = [
    [localPlugin.id, ["音乐源"]], [ncmPlugin.id, ["音频编解码"]],
    ["musicfs.plugin.decoder.ffmpeg", ["音频编解码"]], ["musicfs.plugin.decoder.channelmix", ["DSP"]],
    [scraperPlugin.id, ["元数据"]], ["example.hybrid.radio", ["音乐源", "元数据"]],
    ["example.processing", ["音频处理"]], ["example.custom", ["custom-feature", "constructor", longFeature]],
    ["example.unclassified", ["未分类"]], ["musicfs.plugin.content.asmr", ["内容类型"]],
  ] as const;
  for (const [id, labels] of purposes) {
    const item = entry(card, id);
    await expect(item.locator(".plugin-entry-heading").getByText("1.2.3", { exact: false })).toBeVisible();
    await item.locator(".plugin-entry-toggle").click();
    for (const label of labels) await expect(item.locator(".plugin-purposes").getByText(label, { exact: true })).toBeVisible();
  }
});

test("type filters accept multiple types as alternatives and return to all plugins when cleared", async ({ page }) => {
  const card = await openPlugins(page);
  const types = card.getByRole("group", { name: "插件类型", exact: true });
  const music = types.getByRole("checkbox", { name: "音乐源", exact: true });
  const metadata = types.getByRole("checkbox", { name: "元数据", exact: true });
  await music.check();
  await expectVisiblePlugins(card, [localPlugin.id, "example.hybrid.radio"]);
  await metadata.check();
  await expectVisiblePlugins(card, [localPlugin.id, scraperPlugin.id, "example.hybrid.radio"]);
  await music.uncheck();
  await expectVisiblePlugins(card, [scraperPlugin.id, "example.hybrid.radio"]);
  await metadata.uncheck();
  await expectVisiblePlugins(card, plugins.map(plugin => plugin.id));

  const codec = types.getByRole("checkbox", { name: "音频编解码", exact: true });
  const dsp = types.getByRole("checkbox", { name: "DSP", exact: true });
  await codec.check();
  await expectVisiblePlugins(card, [ncmPlugin.id, "musicfs.plugin.decoder.ffmpeg"]);
  await dsp.check();
  await expectVisiblePlugins(card, [ncmPlugin.id, "musicfs.plugin.decoder.ffmpeg", "musicfs.plugin.decoder.channelmix"]);
  await codec.uncheck();
  await expectVisiblePlugins(card, ["musicfs.plugin.decoder.channelmix"]);
  await dsp.uncheck();

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

test("shift-click selects only the clicked type and ordinary clicks restore multiple selection", async ({ page }) => {
  const card = await openPlugins(page);
  const types = card.getByRole("group", { name: "插件类型", exact: true });
  const music = types.getByRole("checkbox", { name: "音乐源", exact: true });
  const metadata = types.getByRole("checkbox", { name: "元数据", exact: true });
  const codec = types.getByRole("checkbox", { name: "音频编解码", exact: true });
  const search = card.getByRole("searchbox", { name: "按 ID 或名称筛选插件", exact: true });
  await search.fill("musicfs");
  await music.check();
  await codec.check();

  async function expectOnly(selected: Locator) {
    await expect(types.locator('input:checked')).toHaveCount(1);
    await expect(selected).toBeChecked();
    await expect(types.getByRole("button", { name: "全部", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(search).toHaveValue("musicfs");
  }

  await metadata.click({ modifiers: ["Shift"] });
  await expectOnly(metadata);
  await expectVisiblePlugins(card, [scraperPlugin.id]);
  await music.check();
  await metadata.click({ modifiers: ["Shift"] });
  await expectOnly(metadata);
  await metadata.click({ modifiers: ["Shift"] });
  await expectOnly(metadata);

  const musicLabel = types.locator("label").filter({ has: page.getByRole("checkbox", { name: "音乐源", exact: true }) });
  const labelBox = await musicLabel.boundingBox();
  expect(labelBox).not.toBeNull();
  await musicLabel.click({ modifiers: ["Shift"], position: { x: labelBox!.width - 10, y: labelBox!.height / 2 } });
  await expectOnly(music);
  await expectVisiblePlugins(card, [localPlugin.id]);
  await codec.click();
  await expect(music).toBeChecked();
  await expect(codec).toBeChecked();
  await expect(types.locator('input:checked')).toHaveCount(2);
  await expect(search).toHaveValue("musicfs");
  await expectVisiblePlugins(card, [localPlugin.id, ncmPlugin.id, "musicfs.plugin.decoder.ffmpeg"]);

  await musicLabel.click({ position: { x: labelBox!.width - 20, y: labelBox!.height / 2 } });
  const codecLabel = types.locator("label").filter({ has: page.getByRole("checkbox", { name: "音频编解码", exact: true }) });
  const codecBox = await codecLabel.boundingBox();
  expect(codecBox).not.toBeNull();
  await codecLabel.click({ modifiers: ["Shift"], position: { x: codecBox!.width - 20, y: codecBox!.height / 2 } });
  await expectOnly(codec);
  await expectVisiblePlugins(card, [ncmPlugin.id, "musicfs.plugin.decoder.ffmpeg"]);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  await musicLabel.click({ modifiers: ["Shift"], position: { x: labelBox!.width - 20, y: labelBox!.height / 2 } });
  await expectOnly(music);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  async function clickLabelText(label: Locator) {
    const position = await label.evaluate(element => {
      const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      if (!text) throw new Error("Label text not found");
      const range = document.createRange();
      range.selectNodeContents(text);
      const textBox = range.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      return { x: textBox.x - bounds.x + textBox.width / 2, y: textBox.y - bounds.y + textBox.height / 2 };
    });
    await label.click({ position });
  }

  await codec.click();
  await page.keyboard.down("Shift");
  try {
    await clickLabelText(codecLabel);
    await expectOnly(codec);
    await expect(codec).toBeFocused();
    await clickLabelText(musicLabel);
    await expectOnly(music);
    await clickLabelText(musicLabel);
    await expectOnly(music);
    await codecLabel.click({ position: { x: codecBox!.width - 5, y: codecBox!.height / 2 } });
    await expectOnly(codec);
    await expect(codec).toBeFocused();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  } finally {
    await page.keyboard.up("Shift");
  }
  await page.keyboard.press("Space");
  await expect(types.locator('input:checked')).toHaveCount(0);
  await expect(types.getByRole("button", { name: "全部", exact: true })).toHaveAttribute("aria-pressed", "true");
  await clickLabelText(musicLabel);
  await expectOnly(music);
  await clickLabelText(codecLabel);
  await expect(music).toBeChecked();
  await expect(codec).toBeChecked();
  await expect(types.locator('input:checked')).toHaveCount(2);
  await expect(search).toHaveValue("musicfs");
});

test("plugin type help appears on hover, keyboard focus and click and dismisses with Escape", async ({ page }) => {
  const card = await openPlugins(page);
  const types = card.getByRole("group", { name: "插件类型", exact: true });
  const help = types.getByRole("button", { name: "插件类型筛选说明", exact: true });
  const message = "可多选；按住 Shift 点击可仅选择该类型；未选择时显示全部。";
  const tooltip = page.getByRole("tooltip", { name: message, exact: true });
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute("aria-description", message);
  await expect(tooltip).toBeHidden();
  await help.hover();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();

  await card.getByRole("searchbox", { name: "按 ID 或名称筛选插件", exact: true }).hover();
  await help.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();

  await card.getByRole("searchbox", { name: "按 ID 或名称筛选插件", exact: true }).focus();
  await help.click();
  await expect(tooltip).toBeVisible();
  await expect(types.locator('input:checked')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
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
  const item = entry(card, localPlugin.id);
  await expect(item.locator(".plugin-entry-heading").getByText("2.0.0", { exact: false })).toBeVisible();
  await expect(music).toBeChecked();
  await expect(search).toHaveValue("local");
});

for (const [locale, group, all, metadata, codec, contentType, searchLabel, empty] of [
  ["en", "Plugin types", "All", "Metadata", "Audio codecs", "Content type", "Filter plugins by ID or name", "No plugins match these filters."],
  ["zh-TW", "外掛程式類型", "全部", "中繼資料", "音訊編解碼", "內容類型", "依 ID 或名稱篩選外掛程式", "沒有符合篩選條件的外掛程式。"],
  ["ja", "プラグインの種類", "すべて", "メタデータ", "音声コーデック", "コンテンツの種類", "ID または名前でプラグインを絞り込み", "条件に一致するプラグインはありません。"],
] as const) {
  test(`plugin filter controls and purposes follow the ${locale} language preference`, async ({ page }) => {
    await page.addInitScript(language => localStorage.setItem("musicfs:language", language), locale);
    const card = await openPlugins(page);
    const types = card.getByRole("group", { name: group, exact: true });
    await expect(types.getByRole("button", { name: all, exact: true })).toBeVisible();
    await expect(types.getByRole("checkbox", { name: metadata, exact: true })).toBeVisible();
    await expect(types.getByRole("checkbox", { name: codec, exact: true })).toBeVisible();
    const scraper = entry(card, scraperPlugin.id);
    await scraper.locator(".plugin-entry-toggle").click();
    const purposes = scraper.locator(".plugin-purposes");
    await expect(purposes.getByText(metadata, { exact: true })).toBeVisible();
    await types.getByRole("checkbox", { name: contentType, exact: true }).check();
    await expectVisiblePlugins(card, ["musicfs.plugin.content.asmr"]);
    await entry(card, "musicfs.plugin.content.asmr").locator(".plugin-entry-toggle").click();
    await expect(card.locator(".plugin-purposes").getByText(contentType, { exact: true })).toBeVisible();
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
  await types.getByRole("checkbox", { name: "元数据", exact: true }).check();
  await search.fill("hybrid");
  await expectVisiblePlugins(card, ["example.hybrid.radio"]);
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("plugin-filters-mobile.png"), fullPage: true });
});
