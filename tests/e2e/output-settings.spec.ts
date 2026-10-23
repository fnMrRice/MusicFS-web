import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";

let server: PreviewServer;
const origin = "http://127.0.0.1:18159";
const outputKey = `musicfs:audio-output:v1:${encodeURIComponent(`${origin}/api/v1`)}:listener`;
const effectKey = "musicfs:local-dsp:v1:output-test:listener";
const limitedMessage = "当前设备无法使用所选布局，已自动使用支持的声道数；保存的偏好不会改变。";

test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18159, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

async function mock(page: Page, maxChannels = 8) {
  const requests: string[] = [];
  await page.addInitScript((maximum) => {
    Object.defineProperty(AudioDestinationNode.prototype, "maxChannelCount", { get: () => maximum, configurable: true });
  }, maxChannels);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: "1" };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "output-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "listener", role: "admin" } };
    await route.fulfill({ json });
  });
  return requests;
}

async function open(page: Page) {
  await page.goto(`${origin}/#/settings?tab=dsp`);
}

test("output settings default to source channels with stereo expansion disabled and no server controls", async ({ page }, info) => {
  const requests = await mock(page);
  await open(page);
  const layout = page.getByLabel("输出声道", { exact: true });
  await expect(layout).toHaveValue("source");
  await expect(page.getByLabel("立体声环绕扩展", { exact: true })).not.toBeChecked();
  for (const value of ["source", "mono", "stereo", "5.1", "7.1"]) await expect(layout.locator(`option[value='${value}']`)).toHaveJSProperty("disabled", false);
  await expect(page.getByRole("region", { name: "输出设置", exact: true }).getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "服务端格式转换", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "全局格式转换", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("使用全局配置", { exact: true })).toHaveCount(0);
  expect(requests.filter((path) => path.includes("/dsp/settings"))).toEqual([]);
  await page.getByRole("region", { name: "输出设置", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("output-settings-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "输出设置", exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("output-settings-mobile.png") });
});

test("output drafts save and revert independently from the disabled local effect chain", async ({ page }) => {
  const requests = await mock(page);
  await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ enabled: false, chain: [] })), effectKey);
  await open(page);
  const layout = page.getByLabel("输出声道", { exact: true });
  const expansion = page.getByLabel("立体声环绕扩展", { exact: true });
  const save = page.getByRole("region", { name: "输出设置", exact: true }).getByRole("button", { name: "保存", exact: true });
  await layout.selectOption("5.1"); await expansion.check();
  await expect(page.getByRole("region", { name: "输出设置", exact: true }).getByText("有未保存的更改", { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), outputKey)).toBeNull();
  await save.click();
  await expect(page.getByRole("region", { name: "输出设置", exact: true }).getByText("已保存", { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), outputKey)).toEqual({ layout: "5.1", expandStereo: true });
  await layout.selectOption("7.1"); await expansion.uncheck();
  await page.getByRole("region", { name: "输出设置", exact: true }).getByRole("button", { name: "撤销更改", exact: true }).click();
  await expect(layout).toHaveValue("5.1"); await expect(expansion).toBeChecked();
  await expect(save).toBeDisabled();
  await expansion.uncheck(); await layout.selectOption("mono");
  await page.reload();
  await expect(layout).toHaveValue("5.1"); await expect(expansion).toBeChecked();
  await expect(page.getByLabel("启用本地音效", { exact: true })).not.toBeChecked();
  await expansion.uncheck(); await save.click();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), outputKey)).toEqual({ layout: "5.1", expandStereo: false });
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), effectKey)).toEqual({ enabled: false, chain: [] });
  expect(requests.filter((path) => path.includes("/dsp/settings"))).toEqual([]);
});

test("device limits disable unsupported output choices but preserve saved surround preferences", async ({ page }) => {
  const requests = await mock(page, 2);
  await page.addInitScript((key) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ layout: "7.1", expandStereo: true })); }, outputKey);
  await open(page);
  const layout = page.getByLabel("输出声道", { exact: true });
  await expect(layout).toHaveValue("7.1");
  for (const value of ["source", "mono", "stereo"]) await expect(layout.locator(`option[value='${value}']`)).toHaveJSProperty("disabled", false);
  for (const value of ["5.1", "7.1"]) await expect(layout.locator(`option[value='${value}']`)).toHaveJSProperty("disabled", true);
  await expect(page.getByText(limitedMessage, { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "输出设置", exact: true }).getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await layout.selectOption("stereo");
  await expect(page.getByText(limitedMessage, { exact: true })).toHaveCount(0);
  await page.getByRole("region", { name: "输出设置", exact: true }).getByRole("button", { name: "撤销更改", exact: true }).click();
  await expect(layout).toHaveValue("7.1");
  await expect(page.getByText(limitedMessage, { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), outputKey)).toEqual({ layout: "7.1", expandStereo: true });
  expect(requests.filter((path) => path.includes("/dsp/settings"))).toEqual([]);
});

test("unsupported browsers explain output fallback and retain ordinary playback", async ({ page }) => {
  const requests = await mock(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { value: undefined, configurable: true });
    Object.defineProperty(window, "webkitAudioContext", { value: undefined, configurable: true });
  });
  await open(page);
  await expect(page.getByText("此浏览器不支持输出调整，将使用默认播放输出。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("输出声道", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("立体声环绕扩展", { exact: true })).toBeDisabled();
  expect(requests.filter((path) => path.includes("/dsp/settings"))).toEqual([]);
});
