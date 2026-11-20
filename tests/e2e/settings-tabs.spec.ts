import { instanceIds, localPlugin } from "../fixtures/plugins";
import { routeApi } from "../fixtures/control-mock";
import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";

let server: PreviewServer;
const origin = "http://127.0.0.1:18145";
const sections = [
  ["sources", "音乐源"], ["plugins", "插件管理"], ["playback", "播放配置"],
  ["dsp", "音效与输出"], ["appearance", "外观与语言"], ["user", "用户"], ["about", "关于"],
] as const;
const sectionNames = sections.map(([, name]) => name);
const processingLabel = "强制服务端转码（下一首生效）";
const local = {
  id: instanceIds.local, name: "Fixture library", availability: "available", capabilities: [],
  plugin: { id: "musicfs.plugin.source.localfiles", name: "Local files", localizedNames: { "zh-CN": "本地音乐" }, features: ["music-source"] },
};

test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 18145, strictPort: true } });
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

async function mock(page: Page, role = "admin") {
  const requests: string[] = [];
  const prefix = "musicfs.scraper.";
  const scrapers = ["musicbrainz", "itunes", "netease", "qqmusic"].map(name => ({
    pluginId: prefix + name, name, type: "scraper", fields: ["albumDetails", "albumTracks"], available: true,
  }));
  let albumSettings = { revision: 0, localPluginOrder: scrapers.slice(0, 3).map(source => source.pluginId) };
  await routeApi(page, (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: "1" };
    if (path.endsWith('/scan-status')) json = { job: null };
    if (path.endsWith('/root-statistics')) json = { roots: [] };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, serverVersion: "2.4.1", apiVersion: "1", instanceId: "settings-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "listener", role } };
    if (path.endsWith("/provider-instances")) json = { items: [local] };
    if (path.endsWith("/scrapers")) json = { items: scrapers };
    if (path.endsWith("/scrapers/album-auto-settings")) {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        expect(body.expectedRevision).toBe(albumSettings.revision);
        expect(route.request().headers()["idempotency-key"]).toBeTruthy();
        albumSettings = { revision: albumSettings.revision + 1, localPluginOrder: body.localPluginOrder };
      }
      json = albumSettings;
    }
    if (path.endsWith("/admin/plugins")) json = { items: [{
      pluginId: localPlugin.id, plugin: localPlugin, supportsMultipleInstances: false, instances: [{ instanceId: instanceIds.local, name: "Local library", runtimeState: "ready" }],
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

function navigation(page: Page) {
  return page.getByRole("navigation", { name: "设置分类", exact: true });
}

function section(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

async function expectAnchor(page: Page, name: string) {
  const nav = navigation(page);
  await expect(nav.getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "location");
  await expect(nav).toBeInViewport();
  await expect.poll(async () => {
    const [navBox, sectionBox] = await Promise.all([nav.boundingBox(), section(page, name).boundingBox()]);
    return !!navBox && !!sectionBox && sectionBox.y >= navBox.y + navBox.height - 2
      && sectionBox.y <= navBox.y + navBox.height + 48;
  }).toBe(true);
}

async function navigate(page: Page, name: string) {
  await navigation(page).getByRole("button", { name, exact: true }).click();
  await expectAnchor(page, name);
}

for (const [language, sectionName, serverLabel, webLabel, width] of [
  ["zh-CN", "关于", "服务端版本", "Web 版本", 1200],
  ["en", "About", "Server version", "Web version", 390],
] as const) {
  test(`about shows the server and web versions in ${language} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(language => localStorage.setItem("musicfs:language", language), language);
    await mock(page, "user");
    await page.goto(`${origin}/#/settings?tab=about`);
    const about = section(page, sectionName);
    const manifest = await page.request.get(`${origin}/version.json`);
    const { webVersion } = await manifest.json();
    await expect(about.getByText(serverLabel, { exact: true }).locator("+ dd")).toHaveText("2.4.1");
    await expect(about.getByText(webLabel, { exact: true }).locator("+ dd")).toHaveText(webVersion);
    await expect(about.getByText(webVersion, { exact: true })).toBeInViewport();
    expect(await about.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

test("listeners can save and reload the local album scraper order", async ({ page }) => {
  await mock(page, "user");
  await page.goto(`${origin}/#/settings?tab=sources`);
  const settings = section(page, "本地专辑刮削顺序");
  const names = settings.locator("li span");
  await expect(names).toHaveText(["MusicBrainz", "Apple Music (iTunes)", "网易云音乐"]);
  await settings.getByRole("button", { name: "上移 Apple Music (iTunes)" }).click();
  await settings.getByRole("button", { name: "移除 网易云音乐" }).click();
  await settings.getByLabel("添加刮削来源").selectOption("musicfs.scraper.qqmusic");
  await settings.getByRole("button", { name: "保存设置" }).click();
  await expect(settings.getByRole("status")).toHaveText("设置已保存。");
  await page.reload();
  await expect(names).toHaveText(["Apple Music (iTunes)", "MusicBrainz", "QQ 音乐"]);
});

test("settings keep every section mounted and preserve playback preferences after scrolling and refresh", async ({ page }, info) => {
  await mock(page);
  await page.goto(`${origin}/#/settings`);
  const nav = navigation(page);
  await expect(nav.getByRole("button")).toHaveText(sectionNames);
  await expect(nav.getByRole("button", { name: "音乐源", exact: true })).toHaveAttribute("aria-current", "location");
  for (const [id, name] of sections) {
    await expect(section(page, name)).toBeVisible();
    await expect(section(page, name)).toHaveAttribute("id", `settings-panel-${id}`);
    await expect(section(page, name).getByRole("heading", { level: 2, name, exact: true })).toHaveCount(1);
    await expect(nav.getByRole("button", { name, exact: true })).toHaveAttribute("aria-controls", `settings-panel-${id}`);
  }
  await expect(page.getByRole("heading", { name: "本地音乐", exact: true })).toBeVisible();
  for (const name of ["音乐来源", "插件列表", "其他配置", "DSP 配置"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByText("公开匿名来源无需平台账号；其他来源按提示登录。登录不代表拥有会员或完整播放权限。", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(processingLabel)).toHaveCount(1);
  await expect(page.locator(".language-select select")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "你的聆听偏好", exact: true })).toHaveCount(0);
  await expect(page.getByText("MAKE YOURSELF AT HOME", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("settings-sources-desktop.png") });

  await navigate(page, "插件管理");
  await navigate(page, "播放配置");
  const playback = section(page, "播放配置");
  const volume = playback.getByRole("slider", { name: "音量", exact: true });
  const processing = playback.getByRole("checkbox", { name: processingLabel, exact: true });
  expect(await volume.evaluate((element) => !!(element.compareDocumentPosition(document.querySelector(".playback-switch")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.getByText("服务端负责格式转换与转码；音效和输出声道在浏览器中实时调整。", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("切歌淡出淡入", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("自动音量平衡", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("淡出淡入时长（毫秒）", { exact: true })).toHaveCount(0);
  await processing.check();
  await page.getByLabel("切歌淡出淡入", { exact: true }).check();
  await expect(page.getByLabel("淡出淡入时长（毫秒）", { exact: true })).toHaveValue("300");
  await page.getByLabel("淡出淡入时长（毫秒）", { exact: true }).fill("750");
  await page.getByLabel("自动音量平衡", { exact: true }).check();
  await volume.fill("0.42");
  await navigate(page, "外观与语言");
  await expect(page.locator(".language-select select")).toBeVisible();
  for (const name of ["外观与语言", "用户", "关于"]) {
    await expect(section(page, name).getByRole("heading", { level: 3 })).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  expect(await section(page, "外观与语言").evaluate((element) => {
    const appearance = element.querySelector(".theme-choices");
    const language = element.querySelector(".language-select");
    return !!appearance && !!language && !!(appearance.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await expect(processing).toBeChecked();
  await section(page, "外观与语言").getByRole("button", { name: "晨光 · 浅色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await navigate(page, "播放配置");
  await page.reload();
  await expect(page).toHaveURL(/\/settings\?tab=playback$/);
  await expectAnchor(page, "播放配置");
  await expect(processing).toBeChecked();
  await expect(page.getByLabel("切歌淡出淡入", { exact: true })).toBeChecked();
  await expect(page.getByLabel("淡出淡入时长（毫秒）", { exact: true })).toHaveValue("750");
  await expect(page.getByLabel("自动音量平衡", { exact: true })).toBeChecked();
  await expect(volume).toHaveValue("0.42");
  await page.screenshot({ path: info.outputPath("settings-playback-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await navigate(page, "播放配置");
  await expect(nav.getByRole("button", { name: "播放配置", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("settings-playback-mobile.png") });
  await navigate(page, "外观与语言");
  await expect(page.locator(".language-select select")).toBeInViewport();
  await section(page, "外观与语言").getByRole("button", { name: "深夜 · 深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 1200, height: 900 });
  await navigate(page, "播放配置");
  await page.screenshot({ path: info.outputPath("settings-playback-desktop-dark.png") });
});

test("all seven anchors reach their headings on desktop and narrow screens", async ({ page }) => {
  await mock(page);
  await page.goto(`${origin}/#/settings?tab=other`);
  await expectAnchor(page, "外观与语言");
  for (const viewport of [{ width: 1200, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const [id, name] of sections) {
      await navigate(page, name);
      await expect(page).toHaveURL(new RegExp(`tab=${id}$`));
      await expect(navigation(page).getByRole("button", { name, exact: true })).toBeInViewport();
      await expect(section(page, name).getByRole("heading", { level: 2, name, exact: true })).toBeInViewport();
    }
  }
  for (const [id, name] of sections.slice(-2)) {
    await page.goto(`${origin}/#/settings?tab=${id}`);
    await page.reload();
    await expectAnchor(page, name);
  }
});

test("manual scrolling updates the current section while the section navigation stays visible", async ({ page }) => {
  await mock(page);
  await page.goto(`${origin}/#/settings`);
  await expect(page.getByRole("heading", { name: "本地音乐", exact: true })).toBeVisible();
  await expect(section(page, "插件管理").getByRole("button", { name: "刷新插件列表", exact: true })).toBeEnabled();
  for (const name of [...sectionNames.slice(1), "音乐源"]) {
    const navBox = (await navigation(page).boundingBox())!;
    const targetBox = (await section(page, name).boundingBox())!;
    await page.mouse.move(navBox.x + navBox.width / 2, navBox.y + navBox.height + 80);
    await page.mouse.wheel(0, targetBox.y - navBox.y - navBox.height - 16);
    await expectAnchor(page, name);
    await expect(navigation(page).locator('[aria-current="location"]')).toHaveCount(1);
  }
});

test("history restores the manual scroll position instead of the section in the deep link", async ({ page }) => {
  await mock(page);
  await page.goto(`${origin}/#/settings?tab=dsp`);
  await expectAnchor(page, "音效与输出");
  const scrollRoot = page.locator("#page-scroll");
  const deepLinkScroll = await scrollRoot.evaluate((element) => element.scrollTop);
  const navBox = (await navigation(page).boundingBox())!;
  const appearanceBox = (await section(page, "外观与语言").boundingBox())!;
  const delta = appearanceBox.y - navBox.y - navBox.height + 120;
  const target = await scrollRoot.evaluate((element, offset) =>
    Math.min(element.scrollHeight - element.clientHeight, element.scrollTop + offset), delta);
  await page.mouse.move(navBox.x + navBox.width / 2, navBox.y + navBox.height + 80);
  await page.mouse.wheel(0, delta);
  await expect.poll(async () => Math.abs(await scrollRoot.evaluate((element) => element.scrollTop) - target)).toBeLessThanOrEqual(2);
  await expect(navigation(page).getByRole("button", { name: "外观与语言", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(page).toHaveURL(/\/settings\?tab=dsp$/);
  const savedScroll = await scrollRoot.evaluate((element) => element.scrollTop);
  expect(savedScroll).toBeGreaterThan(deepLinkScroll + 100);

  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "搜索", exact: true }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/settings\?tab=dsp$/);
  await expect.poll(async () => Math.abs(await scrollRoot.evaluate((element) => element.scrollTop) - savedScroll)).toBeLessThanOrEqual(2);
  await expect(navigation(page).getByRole("button", { name: "外观与语言", exact: true })).toHaveAttribute("aria-current", "location");
});

test("effects and output share one divided card and keep unsaved effects while navigating", async ({ page }, info) => {
  await mock(page);
  await page.goto(`${origin}/#/settings?tab=dsp`);
  await expectAnchor(page, "音效与输出");
  const dsp = section(page, "音效与输出");
  const localEffects = dsp.getByRole("region", { name: "本地音效", exact: true });
  const output = dsp.getByRole("region", { name: "输出设置", exact: true });
  await expect(localEffects).toBeVisible();
  await expect(output).toBeVisible();
  await expect(dsp.locator(".settings-card")).toHaveCount(1);
  await expect(dsp.locator(".settings-card").getByRole("heading", { level: 3 })).toHaveText(["本地音效", "输出设置"]);
  await expect(localEffects.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(output.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(await output.evaluate((element) => {
    const style = getComputedStyle(element);
    return parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none" && parseFloat(style.paddingTop) > 0;
  })).toBe(true);
  await expect(dsp.getByRole("tab")).toHaveCount(0);
  await expect(dsp.getByRole("button", { name: "本地音效", exact: true })).toHaveCount(0);
  const [localBox, outputBox] = await Promise.all([localEffects.boundingBox(), output.boundingBox()]);
  expect(outputBox!.y).toBeGreaterThanOrEqual(localBox!.y + localBox!.height);
  await page.screenshot({ path: info.outputPath("settings-dsp-desktop.png") });

  await localEffects.getByRole("button", { name: "添加效果", exact: true }).click();
  await localEffects.getByRole("button", { name: "展开 增益", exact: true }).click();
  await localEffects.getByRole("spinbutton", { name: "增益（dB）", exact: true }).fill("4.5");
  await localEffects.getByLabel("选择效果", { exact: true }).selectOption("reverb");
  await expect(localEffects.getByText("有未保存的更改", { exact: true })).toBeVisible();
  await expect(localEffects.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  await expect(output.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await navigate(page, "外观与语言");
  await navigate(page, "音效与输出");
  await expect(localEffects.getByRole("button", { name: "收起 增益", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(localEffects.getByRole("spinbutton", { name: "增益（dB）", exact: true })).toHaveValue("4.5");
  await expect(localEffects.getByLabel("选择效果", { exact: true })).toHaveValue("reverb");
  await expect(localEffects.getByText("有未保存的更改", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await navigate(page, "音效与输出");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("settings-dsp-mobile.png") });
});

test("playback fades clamp duration and retain the preference while disabled", async ({ page }) => {
  const requests = await mock(page);
  await page.goto(`${origin}/#/settings?tab=playback`);
  await expectAnchor(page, "播放配置");
  await page.getByLabel("切歌淡出淡入", { exact: true }).check();
  const duration = page.getByLabel("淡出淡入时长（毫秒）", { exact: true });
  await duration.fill("50");
  await page.getByRole("heading", { name: "播放", exact: true }).click();
  await expect(duration).toHaveValue("100");
  await duration.fill("3000");
  await page.getByRole("heading", { name: "播放", exact: true }).click();
  await expect(duration).toHaveValue("2000");
  await page.getByLabel("切歌淡出淡入", { exact: true }).uncheck();
  await expect(duration).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("切歌淡出淡入", { exact: true })).not.toBeChecked();
  await page.getByLabel("切歌淡出淡入", { exact: true }).check();
  await expect(duration).toHaveValue("2000");
  expect(requests.filter((path) => path.includes("/dsp/settings") || path.includes("/playback/sessions"))).toEqual([]);
});

test("section navigation replaces history and unknown links fall back to music sources", async ({ page }) => {
  await mock(page);
  await page.goto(`${origin}/#/library`);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await navigate(page, "播放配置");
  await navigate(page, "外观与语言");
  await page.goBack();
  await expect(page).toHaveURL(/\/library$/);
  await page.goto(`${origin}/#/settings?tab=unknown&from=fixture`);
  await expect(navigation(page).getByRole("button", { name: "音乐源", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(page.getByRole("heading", { name: "本地音乐", exact: true })).toBeInViewport();
  await navigate(page, "外观与语言");
  await expect(page).toHaveURL(/tab=appearance&from=fixture$/);
});

test("section buttons support native keyboard navigation and focus the selected section", async ({ page }) => {
  await mock(page);
  await page.goto(`${origin}/#/settings?tab=playback`);
  await expectAnchor(page, "播放配置");
  const nav = navigation(page);
  const playback = nav.getByRole("button", { name: "播放配置", exact: true });
  const dsp = nav.getByRole("button", { name: "音效与输出", exact: true });
  const appearance = nav.getByRole("button", { name: "外观与语言", exact: true });
  await playback.focus();
  await page.keyboard.press("Tab");
  await expect(dsp).toBeFocused();
  await expect(playback).toHaveAttribute("aria-current", "location");
  await page.keyboard.press("Enter");
  await expectAnchor(page, "音效与输出");
  await expect(page).toHaveURL(/tab=dsp$/);
  await expect(section(page, "音效与输出")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(section(page, "音效与输出").getByRole("checkbox", { name: "启用本地音效", exact: true })).toBeFocused();
  await appearance.evaluate((element) => element.focus({ preventScroll: true }));
  await expect(appearance).toBeFocused();
  await page.keyboard.press("Space");
  await expectAnchor(page, "外观与语言");
  await expect(page).toHaveURL(/tab=appearance$/);
  await expect(section(page, "外观与语言")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(section(page, "外观与语言").getByRole("button", { name: "深夜 · 深色", exact: true })).toBeFocused();
  await appearance.evaluate((element) => element.focus({ preventScroll: true }));
  await page.keyboard.press("Shift+Tab");
  await expect(dsp).toBeFocused();
  await expect(page).toHaveURL(/tab=appearance$/);
});

test("regular users retain every section and see plugin permissions without admin requests", async ({ page }) => {
  const requests = await mock(page, "user");
  await page.goto(`${origin}/#/settings?tab=plugins`);
  await expect(navigation(page).getByRole("button")).toHaveText(sectionNames);
  await expectAnchor(page, "插件管理");
  await expect(page.getByText("插件管理仅对管理员开放。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新插件列表", exact: true })).toHaveCount(0);
  await navigate(page, "音乐源");
  await expect(page.getByRole("heading", { name: "本地音乐", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(添加本地目录|管理音乐目录)$/ })).toHaveCount(0);
  expect(requests.filter((path) => path.includes("/admin/"))).toEqual([]);
});

test("legacy directory links take priority and dismiss before navigating to another section", async ({ page }) => {
  await mock(page);
  await page.goto(`${origin}/#/settings?tab=plugins&directories=${instanceIds.local}`);
  await expect(navigation(page).getByRole("button", { name: "音乐源", exact: true })).toHaveAttribute("aria-current", "location");
  const directories = page.getByRole("dialog", { name: "添加本地目录", exact: true });
  await expect(directories).toHaveCount(1);
  await page.getByRole("button", { name: /^(取消|收起目录管理)$/ }).click();
  await expect(directories).toHaveCount(0);
  await navigate(page, "播放配置");
  await expect(page).toHaveURL(/\/settings\?tab=playback$/);
  await page.reload();
  await expectAnchor(page, "播放配置");
  await expect(page.getByLabel(processingLabel)).toBeVisible();
  await expect(directories).toHaveCount(0);
});

test("scrolling away from music sources preserves authorization and its polling", async ({ page }) => {
  await mock(page);
  const actions: { action: string; loginId: string }[] = [];
  let account: Record<string, unknown> = { state: "signedOut" };
  await page.route("**/api/v1/online-instances", (route) => route.fulfill({ json: { items: [{
    instanceId: instanceIds.qqmusic, name: "QQ fixture", platform: "qqmusic", availability: "loginRequired", capabilities: [],
    plugin: { id: "musicfs.plugin.source.qqmusic", name: "QQ Music", localizedNames: { "zh-CN": "QQ音乐" }, features: ["music-source"] },
  }] } }));
  await page.route(`**/api/v1/online-instances/${instanceIds.qqmusic}/account/options`, (route) => route.fulfill({ json: { method: "qr", configured: true } }));
  await page.route(`**/api/v1/online-instances/${instanceIds.qqmusic}/account`, (route) => {
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
  await navigate(page, "播放配置");
  await expect(page.getByAltText("QQ音乐登录二维码", { exact: true })).toHaveCount(1);
  await expect.poll(() => actions.some(({ action }) => action === "poll")).toBe(true);
  await navigate(page, "音乐源");
  await expect(page.getByText("等待授权", { exact: true })).toBeVisible();
  await expect(page.getByAltText("QQ音乐登录二维码", { exact: true })).toBeVisible();
  expect(actions.filter(({ action }) => action === "begin")).toHaveLength(1);
  expect(actions.filter(({ action }) => action === "cancel")).toEqual([]);
});
