import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";

let server: PreviewServer;
const origin = "http://127.0.0.1:18158";

test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18158, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

async function mock(page: Page) {
  const control = { requests: [] as string[] };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    control.requests.push(path);
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: "1" };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "dsp-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "listener", role: "user" } };
    return route.fulfill({ json });
  });
  return control;
}

const localStorageKey = "musicfs:local-dsp:v1:dsp-test:listener";

test("local effects preview drafts, save explicitly, and restore saved values without server requests", async ({ page }) => {
  const control = await mock(page);
  await page.goto(`${origin}/#/settings?tab=dsp`);
  await expect(page.getByRole("heading", { name: "本地音效", exact: true })).toHaveCount(0);
  await expect(page.getByText("音效在此浏览器处理，调整立即生效，无需重新播放。设置仅保存在本浏览器，按实例和账号区分。", { exact: true })).toHaveCount(0);
  await expect(page.getByText("服务端负责格式转换、转码及必要的声道转换；Web 播放不会重复应用服务端音效。", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("启用本地音效", { exact: true })).toBeChecked();
  await expect(page.locator(".dsp-chain > li")).toHaveCount(0);
  const save = page.getByRole("button", { name: "保存", exact: true });
  const revert = page.getByRole("button", { name: "撤销更改", exact: true });
  await expect(save).toBeDisabled();
  await expect(page.getByLabel("DSP Buffer 大小（帧）", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "添加效果", exact: true }).click();
  await page.getByRole("button", { name: "添加效果", exact: true }).click();
  const nodes = page.locator(".dsp-chain > li");
  for (const node of await nodes.all()) await node.getByRole("button", { name: "展开 增益", exact: true }).click();
  await nodes.nth(1).getByLabel("增益（dB）", { exact: true }).fill("-6");
  await nodes.nth(1).getByRole("button", { name: "拖动 增益", exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(nodes.nth(0).getByLabel("增益（dB）", { exact: true })).toHaveValue("-6");
  await page.keyboard.press("ArrowDown");
  await expect(nodes.nth(1).getByLabel("增益（dB）", { exact: true })).toHaveValue("-6");
  await page.keyboard.press("ArrowUp");
  await expect(nodes.nth(0).getByLabel("增益（dB）", { exact: true })).toHaveValue("-6");
  await nodes.nth(1).getByRole("button", { name: "删除 增益", exact: true }).click();
  await page.getByLabel("选择效果", { exact: true }).selectOption("equalizer");
  await page.getByRole("button", { name: "添加效果", exact: true }).click();
  await page.getByRole("button", { name: "展开 参数均衡器", exact: true }).click();
  await page.getByRole("slider", { name: "调节 中心频率（Hz）", exact: true }).fill("2500");
  await expect(page.getByLabel("中心频率（Hz）", { exact: true })).toHaveValue("2500");
  await nodes.nth(0).getByLabel("启用 增益", { exact: true }).uncheck();
  await expect(page.getByText("有未保存的更改", { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), localStorageKey)).toBeNull();
  await save.click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), localStorageKey);
  expect(saved).toMatchObject({ enabled: true, chain: [
    { kind: "gain", enabled: false, params: { gain: -6 } },
    { kind: "equalizer", enabled: true, params: { frequency: 2500 } },
  ] });
  await page.getByLabel("启用本地音效", { exact: true }).uncheck();
  await nodes.first().getByLabel("增益（dB）", { exact: true }).fill("-12");
  await page.reload();
  await page.getByRole("button", { name: "展开 增益", exact: true }).click();
  await page.getByRole("button", { name: "展开 参数均衡器", exact: true }).click();
  await expect(page.getByLabel("启用本地音效", { exact: true })).toBeChecked();
  await expect(page.getByLabel("中心频率（Hz）", { exact: true })).toHaveValue("2500");
  await expect(nodes.first().getByLabel("增益（dB）", { exact: true })).toHaveValue("-6");
  await page.getByRole("button", { name: "恢复本地默认", exact: true }).click();
  await expect(nodes).toHaveCount(0);
  await expect(save).toBeEnabled();
  await revert.click();
  await expect(nodes).toHaveCount(2);
  await page.getByRole("button", { name: "展开 增益", exact: true }).click();
  await expect(nodes.first().getByLabel("增益（dB）", { exact: true })).toHaveValue("-6");
  await expect(save).toBeDisabled();
  await page.getByLabel("启用本地音效", { exact: true }).uncheck();
  await save.click();
  await page.reload();
  await expect(page.getByLabel("启用本地音效", { exact: true })).not.toBeChecked();
  expect(control.requests.filter((path) => path.includes("/dsp/settings"))).toEqual([]);
});

test("effect cards retain parameters when collapsed and pointer order survives saving", async ({ page }, info) => {
  await mock(page);
  await page.goto(`${origin}/#/settings?tab=dsp`);
  for (const kind of ["gain", "reverb", "equalizer"]) {
    await page.getByLabel("选择效果", { exact: true }).selectOption(kind);
    await page.getByRole("button", { name: "添加效果", exact: true }).click();
  }
  const nodes = page.locator(".dsp-chain > li");
  await page.getByRole("button", { name: "展开 增益", exact: true }).click();
  await nodes.first().getByLabel("增益（dB）", { exact: true }).fill("-4");
  await page.getByRole("button", { name: "收起 增益", exact: true }).click();
  await expect(page.getByLabel("中心频率（Hz）", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "展开 增益", exact: true }).click();
  await expect(nodes.first().getByLabel("增益（dB）", { exact: true })).toHaveValue("-4");
  await page.getByRole("button", { name: "收起 增益", exact: true }).click();
  const handle = page.getByRole("button", { name: "拖动 增益", exact: true });
  await handle.scrollIntoViewIfNeeded();
  const source = (await handle.boundingBox())!;
  const destination = (await nodes.last().boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, destination.y + destination.height - 8, { steps: 16 });
  await page.mouse.up();
  await expect(nodes.first().getByRole("button", { name: "展开 混响", exact: true })).toBeVisible();
  await expect(nodes.last().getByRole("button", { name: "展开 增益", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.reload();
  await expect(nodes.first().getByRole("button", { name: "展开 混响", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "展开 增益", exact: true }).click();
  await expect(nodes.last().getByLabel("增益（dB）", { exact: true })).toHaveValue("-4");
  await page.getByRole("button", { name: "展开 混响", exact: true }).click();
  await page.getByRole("button", { name: "收起 混响", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("local-dsp-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await nodes.last().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("local-dsp-mobile.png") });
});

test("ten band equalizer supports presets, individual tuning, reset and saved mobile editing", async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mock(page);
  await page.goto(`${origin}/#/settings?tab=dsp`);
  await page.getByLabel("选择效果", { exact: true }).selectOption("graphicEqualizer");
  await page.getByRole("button", { name: "添加效果", exact: true }).click();
  await page.getByRole("button", { name: "展开 均衡器", exact: true }).click();
  const bands = page.getByRole("slider", { name: /^调节 \d+ Hz$/ });
  const preset = page.getByLabel("均衡器预设", { exact: true });
  await expect(bands).toHaveCount(10);
  await expect(preset).toHaveValue("flat");
  const lowBand = page.getByRole("slider", { name: "调节 31 Hz", exact: true });
  await lowBand.scrollIntoViewIfNeeded();
  const fader = (await lowBand.boundingBox())!;
  await lowBand.click({ position: { x: fader.width / 2, y: 20 } });
  expect(Number(await lowBand.inputValue())).toBeGreaterThan(0);
  await lowBand.click({ position: { x: fader.width / 2, y: fader.height - 20 } });
  const lowerValue = Number(await lowBand.inputValue());
  expect(lowerValue).toBeLessThan(0);
  await lowBand.focus(); await page.keyboard.press("ArrowUp");
  await expect(lowBand).toHaveValue(String(lowerValue + 0.5));
  await lowBand.fill("6");
  await page.getByRole("slider", { name: "调节 1000 Hz", exact: true }).fill("-3");
  await page.getByRole("slider", { name: "低音增强（dB）", exact: true }).fill("4");
  await expect(preset).toHaveValue("custom");
  await page.getByRole("button", { name: "收起 均衡器", exact: true }).click();
  await expect(preset).toBeHidden();
  await page.getByRole("button", { name: "展开 均衡器", exact: true }).click();
  await expect(page.getByRole("slider", { name: "调节 31 Hz", exact: true })).toHaveValue("6");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "展开 均衡器", exact: true }).click();
  await expect(page.getByRole("slider", { name: "调节 1000 Hz", exact: true })).toHaveValue("-3");
  await expect(page.getByRole("slider", { name: "低音增强（dB）", exact: true })).toHaveValue("4");
  await page.getByRole("button", { name: "重置均衡器", exact: true }).click();
  await expect(preset).toHaveValue("flat");
  const equalizerSliders = page.locator(".graphic-equalizer").getByRole("slider");
  await expect(equalizerSliders).toHaveCount(12);
  for (const slider of await equalizerSliders.all()) await expect(slider).toHaveValue("0");
  await page.getByRole("button", { name: "撤销更改", exact: true }).click();
  await expect(page.getByRole("slider", { name: "调节 31 Hz", exact: true })).toHaveValue("6");
  await preset.selectOption("rock");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "展开 均衡器", exact: true }).click();
  await expect(preset).toHaveValue("rock");
  await page.locator(".dsp-chain > li").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("graphic-equalizer-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await preset.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scroll = page.locator(".graphic-equalizer-scroll");
  expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("graphic-equalizer-mobile.png") });
});

test("local parameters clamp on blur and report unavailable storage when saving", async ({ page }) => {
  await mock(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("musicfs:local-dsp:")) throw new Error("Storage blocked");
      return original.call(this, key, value);
    };
  });
  await page.goto(`${origin}/#/settings?tab=dsp`);
  await page.getByRole("button", { name: "添加效果", exact: true }).click();
  await page.getByRole("button", { name: "展开 增益", exact: true }).click();
  await page.getByLabel("增益（dB）", { exact: true }).fill("99");
  await page.getByLabel("选择效果", { exact: true }).focus();
  await expect(page.getByLabel("增益（dB）", { exact: true })).toHaveValue("12");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("本地存储不可用，当前设置仅在本次页面内保留，刷新后可能丢失。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
});

test("corrupt local settings can be replaced by saving the default configuration", async ({ page }) => {
  await mock(page);
  await page.addInitScript((key) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, "{"); }, localStorageKey);
  await page.goto(`${origin}/#/settings?tab=dsp`);
  const error = page.getByText("无法读取本地音效设置，已使用默认值。", { exact: true });
  const save = page.getByRole("button", { name: "保存", exact: true });
  await expect(error).toBeVisible();
  await expect(page.locator(".dsp-chain > li")).toHaveCount(0);
  await expect(save).toBeEnabled(); await save.click();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), localStorageKey)).toEqual({ enabled: true, chain: [] });
  await page.reload();
  await expect(error).toHaveCount(0); await expect(save).toBeDisabled();
});

test("touch handles reorder collapsed rows while touching a parameter leaves the order intact", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, locale: "zh-CN", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await mock(page); await page.goto(`${origin}/#/settings?tab=dsp`);
    for (const kind of ["gain", "reverb"]) {
      await page.getByLabel("选择效果", { exact: true }).selectOption(kind);
      await page.getByRole("button", { name: "添加效果", exact: true }).click();
    }
    const session = await context.newCDPSession(page);
    async function touch(from: { x: number; y: number }, to: { x: number; y: number }) {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 1 }] });
      for (let step = 1; step <= 8; step++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
        x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8, id: 1,
      }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    const nodes = page.locator(".dsp-chain > li"), handle = page.getByRole("button", { name: "拖动 增益", exact: true });
    await handle.scrollIntoViewIfNeeded();
    const source = (await handle.boundingBox())!, target = (await nodes.last().boundingBox())!;
    await touch({ x: source.x + source.width / 2, y: source.y + source.height / 2 }, { x: source.x + source.width / 2, y: target.y + target.height - 8 });
    await expect(nodes.first().getByRole("button", { name: "展开 混响", exact: true })).toBeVisible();
    await nodes.last().getByRole("button", { name: "展开 增益", exact: true }).click();
    const slider = nodes.last().getByRole("slider", { name: "调节 增益（dB）", exact: true });
    await slider.scrollIntoViewIfNeeded();
    const range = (await slider.boundingBox())!;
    await touch({ x: range.x + range.width / 2, y: range.y + range.height / 2 }, { x: range.x + range.width * 0.85, y: range.y + range.height / 2 });
    expect(Number(await slider.inputValue())).toBeGreaterThan(0);
    await expect(nodes.first().getByRole("button", { name: "展开 混响", exact: true })).toBeVisible();
    await expect(nodes.last().getByRole("button", { name: "收起 增益", exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test("unsupported browsers retain effect controls and explain bypass", async ({ page }) => {
  await mock(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { value: undefined, configurable: true });
    Object.defineProperty(window, "webkitAudioContext", { value: undefined, configurable: true });
  });
  await page.goto(`${origin}/#/settings?tab=dsp`);
  await expect(page.getByLabel("启用本地音效", { exact: true })).toBeDisabled();
  await expect(page.getByText("此浏览器不支持本地音效。仍可正常播放，音效设置会保留。", { exact: true })).toBeVisible();
  await expect(page.getByText("本地音效已开启，参数实时生效。", { exact: true })).toHaveCount(0);
});
