import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { dspPage } from "../fixtures/dsp";
import type { DSPSaveRequest, DSPSettings, DSPValidation } from "../../src/api/dsp";

let server: PreviewServer;
const origin = "http://127.0.0.1:18158";

test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18158, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

async function mock(page: Page, admin = false) {
  const control = { personal: dspPage(), global: dspPage("global"), fail: false, conflict: false,
    saves: [] as { scope: string; body: DSPSaveRequest; key?: string }[], requests: [] as string[] };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    control.requests.push(path);
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: "1" };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "dsp-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "listener", role: admin ? "admin" : "user" } };
    if (path.endsWith("/dsp/settings/validate")) {
      const { settings } = request.postDataJSON() as { settings: DSPSettings };
      const terminalIndex = settings.chain.findIndex((node) => node.name === "terminal");
      if (terminalIndex >= 0 && terminalIndex !== settings.chain.length - 1)
        return route.fulfill({ status: 400, json: { error: { code: "INVALID_ARGUMENT", message: "Terminal output cannot continue DSP" } } });
      const format = (layout: string) => ({ layout, channels: layout === "mono" ? 1 : layout === "5.1" ? 6 : layout === "7.1" ? 8 : 2, sampleRate: 48000, sampleFormat: "f32le" });
      let current = format(settings.outputLayout);
      const nodes: DSPValidation["nodes"] = settings.chain.map((node) => {
        const input = current;
        if (node.name === "channelmix") current = format(({ 1: "mono", 2: "stereo", 6: "5.1", 8: "7.1" } as Record<number, string>)[node.params!.outputChannels]);
        return { name: node.name, input, output: { format: current, canContinueDSP: node.name !== "terminal" } };
      });
      json = { input: format(settings.outputLayout), output: { format: current, canContinueDSP: terminalIndex < 0 }, nodes };
    } else if (path.endsWith("/dsp/settings") || path.endsWith("/dsp/settings/global")) {
      const scope = path.endsWith("/global") ? "global" : "personal";
      if (scope === "global" && !admin) return route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "Forbidden" } } });
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as DSPSaveRequest;
        control.saves.push({ scope, body, key: request.headers()["idempotency-key"] });
        if (control.fail) { control.fail = false; return route.abort("failed"); }
        if (control.conflict) { control.conflict = false; control[scope].revision += 1;
          return route.fulfill({ status: 409, json: { error: { code: "REVISION_CONFLICT", message: "Revision changed" } } }); }
        if (body.expectedRevision !== control[scope].revision)
          return route.fulfill({ status: 409, json: { error: { code: "REVISION_CONFLICT", message: "Revision changed" } } });
        control[scope] = { ...control[scope], revision: control[scope].revision + 1,
          usesGlobal: body.inheritGlobal === true,
          settings: body.inheritGlobal === true ? structuredClone(control.global.settings) : body.settings };
        if (scope === "global") {
          control.personal.defaults = structuredClone(control.global.settings);
          if (control.personal.usesGlobal) control.personal.settings = structuredClone(control.global.settings);
        }
      }
      json = control[scope];
    }
    return route.fulfill({ json });
  });
  return control;
}

async function openServer(page: Page, personal = true) {
  await page.goto(`${origin}/#/settings?tab=dsp`);
  await page.getByRole("button", { name: "服务端格式转换", exact: true }).click();
  if (personal) {
    await expect(page.getByLabel("使用全局配置", { exact: true })).toBeChecked();
    await page.getByLabel("使用全局配置", { exact: true }).uncheck();
  }
}

const savedMessage = "格式转换设置已保存，下次播放时生效。";

test("local effects update immediately, support repeats and reordering, and persist without server saves", async ({ page }, info) => {
  const control = await mock(page);
  control.personal.settings.chain = [{ name: "gain", version: 1, params: { gainDB: -20 } }];
  await page.goto(`${origin}/#/settings?tab=dsp`);
  await expect(page.getByRole("heading", { name: "本地音效", exact: true })).toBeVisible();
  await expect(page.getByLabel("启用本地音效", { exact: true })).toBeChecked();
  await expect(page.locator(".dsp-chain > li")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存设置", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("DSP Buffer 大小（帧）", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "添加效果", exact: true }).click();
  await page.getByRole("button", { name: "添加效果", exact: true }).click();
  const nodes = page.locator(".dsp-chain > li");
  await nodes.nth(1).getByLabel("增益（dB）", { exact: true }).fill("-6");
  await nodes.nth(1).getByRole("button", { name: "上移 增益", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(nodes.nth(0).getByLabel("增益（dB）", { exact: true })).toHaveValue("-6");
  await nodes.nth(1).getByRole("button", { name: "删除 增益", exact: true }).click();
  await page.getByLabel("选择效果", { exact: true }).selectOption("equalizer");
  await page.getByRole("button", { name: "添加效果", exact: true }).click();
  await page.getByRole("slider", { name: "调节 中心频率（Hz）", exact: true }).fill("2500");
  await expect(page.getByLabel("中心频率（Hz）", { exact: true })).toHaveValue("2500");
  await nodes.nth(0).getByLabel("启用 增益", { exact: true }).uncheck();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("musicfs:local-dsp:v1:dsp-test:listener")!));
  expect(saved).toMatchObject({ enabled: true, chain: [
    { kind: "gain", enabled: false, params: { gain: -6 } },
    { kind: "equalizer", enabled: true, params: { frequency: 2500 } },
  ] });
  await page.getByLabel("启用本地音效", { exact: true }).uncheck();
  await page.reload();
  await expect(page.getByLabel("启用本地音效", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("中心频率（Hz）", { exact: true })).toHaveValue("2500");
  await expect(nodes.first().getByLabel("增益（dB）", { exact: true })).toHaveValue("-6");
  expect(control.requests.filter((path) => path.includes("/dsp/settings"))).toEqual([]);
  expect(control.saves).toEqual([]);
  await page.screenshot({ path: info.outputPath("local-dsp-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await nodes.last().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("local-dsp-mobile.png") });
  await page.getByRole("button", { name: "恢复本地默认", exact: true }).click();
  await expect(nodes).toHaveCount(0);
  await expect(page.getByLabel("启用本地音效", { exact: true })).toBeChecked();
});

test("local parameters clamp on blur and report unavailable browser storage", async ({ page }) => {
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
  await page.getByLabel("增益（dB）", { exact: true }).fill("99");
  await page.getByRole("heading", { name: "本地音效", exact: true }).click();
  await expect(page.getByLabel("增益（dB）", { exact: true })).toHaveValue("12");
  await expect(page.getByText("本地存储不可用，当前设置仅在本次页面内保留，刷新后可能丢失。", { exact: true })).toBeVisible();
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

test("server controls edit channel conversion without resubmitting legacy sound effects", async ({ page }) => {
  const control = await mock(page);
  control.personal.settings.chain = [{ name: "gain", version: 1, params: { gainDB: -12 } }];
  await openServer(page);
  await expect(page.getByRole("button", { name: "全局格式转换", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "添加效果", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("DSP Buffer 大小（帧）", { exact: true })).toHaveCount(0);
  await page.getByLabel("输出声道", { exact: true }).selectOption("5.1");
  const save = page.getByRole("button", { name: "保存设置", exact: true });
  await expect(save).toBeEnabled(); await save.click();
  await expect(page.getByText(savedMessage, { exact: true })).toBeVisible();
  expect(control.saves[0].body).toEqual({ expectedRevision: 3, schemaRevision: "dsp-settings-v1", settings: {
    outputLayout: "5.1", bufferFrames: 4096, chain: [],
  } });
  await page.reload();
  await page.getByRole("button", { name: "服务端格式转换", exact: true }).click();
  await expect(page.getByLabel("输出声道", { exact: true })).toHaveValue("5.1");
  expect(control.requests.some((path) => path.endsWith("/global") || path.includes("/admin/"))).toBe(false);
});

test("server conflicts retain the channel draft and retries retain operation identity", async ({ page }) => {
  const control = await mock(page); await openServer(page);
  await page.getByLabel("输出声道", { exact: true }).selectOption("5.1");
  control.conflict = true;
  const save = page.getByRole("button", { name: "保存设置", exact: true });
  await expect(save).toBeEnabled(); await save.click();
  await expect(page.getByRole("alert")).toContainText("你的草稿已保留");
  await expect(page.getByLabel("输出声道", { exact: true })).toHaveValue("5.1");
  await page.getByRole("button", { name: "读取最新版本，保留草稿", exact: true }).click();
  control.fail = true;
  await expect(save).toBeEnabled(); await save.click();
  await expect(page.getByRole("button", { name: "重试上次操作", exact: true })).toBeVisible();
  await expect(page.getByLabel("输出声道", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "重试上次操作", exact: true }).click();
  await expect(page.getByText(savedMessage, { exact: true })).toBeVisible();
  expect(control.saves[1].key).toBe(control.saves[2].key);
  expect(control.saves[1].body.expectedRevision).toBe(4);
});

test("administrators edit global output channels and personal inheritance follows updates", async ({ page }) => {
  const control = await mock(page, true);
  await openServer(page, false);
  await page.getByRole("button", { name: "全局格式转换", exact: true }).click();
  const editor = page.locator(".server-dsp-settings:visible");
  await editor.getByLabel("输出声道", { exact: true }).selectOption("7.1");
  await expect(editor.getByRole("button", { name: "保存设置", exact: true })).toBeEnabled();
  await editor.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(editor.getByText(savedMessage, { exact: true })).toBeVisible();
  expect(control.saves[0].scope).toBe("global");
  await page.getByRole("button", { name: "我的格式转换", exact: true }).click();
  await expect(editor.getByLabel("输出声道", { exact: true })).toHaveValue("7.1");
  await editor.getByLabel("使用全局配置", { exact: true }).uncheck();
  await editor.getByLabel("输出声道", { exact: true }).selectOption("5.1");
  await expect(editor.getByRole("button", { name: "保存设置", exact: true })).toBeEnabled();
  await editor.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(editor.getByRole("button", { name: "保存设置", exact: true })).toBeDisabled();
  await editor.getByLabel("使用全局配置", { exact: true }).check();
  await editor.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(editor.getByText(savedMessage, { exact: true })).toBeVisible();
  expect(control.saves[2].body).toEqual({ expectedRevision: 4, schemaRevision: "dsp-settings-v1", inheritGlobal: true });
});

test("unavailable server conversion remains readable and cannot save", async ({ page }) => {
  const control = await mock(page);
  control.personal.available = false; control.personal.unavailableReason = "Audio processor unavailable";
  await openServer(page);
  await expect(page.getByText("Audio processor unavailable", { exact: true })).toBeVisible();
  await page.getByLabel("输出声道", { exact: true }).selectOption("5.1");
  await expect(page.getByRole("button", { name: "保存设置", exact: true })).toBeDisabled();
  expect(control.saves).toHaveLength(0);
});
