import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { dspPage } from "../fixtures/dsp";
import type { DSPSaveRequest, DSPSettings, DSPValidation } from "../../src/api/dsp";

let server: PreviewServer;
const origin = "http://127.0.0.1:18158";
const bufferLabel = "DSP Buffer 大小（帧）";
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

async function openPersonal(page: Page) {
  await page.goto(`${origin}/#/settings?tab=dsp`);
  await expect(page.getByLabel("使用全局配置", { exact: true })).toBeChecked();
  await page.getByLabel("使用全局配置", { exact: true }).uncheck();
}

test("users add repeated effects, reorder, edit buffer and persist settings across refresh", async ({ page }, info) => {
  const control = await mock(page);
  await openPersonal(page);
  await expect(page.getByRole("button", { name: "全局默认 DSP", exact: true })).toHaveCount(0);
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
  await page.getByLabel("中心频率（Hz）", { exact: true }).fill("2500");
  await page.getByLabel(bufferLabel, { exact: true }).fill("1024");
  await page.getByLabel("输出声道", { exact: true }).selectOption("5.1");
  await expect(page.getByText("在 48 kHz 下，每块约 21.33 毫秒。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存设置", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByText("DSP 设置已保存，将在下一次播放生效。当前歌曲保持原配置。", { exact: true })).toBeVisible();
  expect(control.saves[0].body).toEqual({ expectedRevision: 3, schemaRevision: "dsp-settings-v1", settings: {
    outputLayout: "5.1", bufferFrames: 1024, chain: [
      { name: "gain", version: 1, params: { gainDB: -6 } }, { name: "equalizer", version: 1, params: { frequencyHz: 2500 } },
    ],
  } });
  await page.reload();
  await expect(page.getByLabel(bufferLabel, { exact: true })).toHaveValue("1024");
  await expect(page.getByLabel("增益（dB）", { exact: true })).toHaveValue("-6");
  await expect(page.getByLabel("使用全局配置", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("处理链预览", { exact: true })).toBeVisible();
  expect(control.requests.some((path) => path.endsWith("/global") || path.includes("/admin/"))).toBe(false);
  await page.screenshot({ path: info.outputPath("dsp-desktop.png") });
  await nodes.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("dsp-desktop-chain.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "DSP 配置", exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("dsp-mobile.png") });
  await nodes.last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("dsp-mobile-chain.png") });
  await page.getByRole("button", { name: "保存设置", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("dsp-mobile-actions.png") });
});

test("buffer bounds and a terminal node reject invalid chains without losing the draft", async ({ page }) => {
  await mock(page); await openPersonal(page);
  const save = page.getByRole("button", { name: "保存设置", exact: true });
  await page.getByLabel(bufferLabel, { exact: true }).fill("63"); await expect(save).toBeDisabled();
  await page.getByLabel(bufferLabel, { exact: true }).fill("16385"); await expect(save).toBeDisabled();
  await page.getByLabel(bufferLabel, { exact: true }).fill("1024.5"); await expect(save).toBeDisabled();
  await page.getByLabel(bufferLabel, { exact: true }).fill("64");
  await page.getByLabel("选择效果", { exact: true }).selectOption("terminal");
  await page.getByRole("button", { name: "添加效果", exact: true }).click();
  await page.getByLabel("选择效果", { exact: true }).selectOption("gain");
  await page.getByRole("button", { name: "添加效果", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Terminal output cannot continue DSP"); await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "下移 终端测试效果", exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(page.getByLabel(bufferLabel, { exact: true })).toHaveValue("64");
  await expect(page.getByLabel("处理链预览", { exact: true })).toContainText("不可继续 DSP");
});

test("conflicts retain the draft and retries retain the original operation identity", async ({ page }) => {
  const control = await mock(page); await openPersonal(page);
  await page.getByLabel(bufferLabel, { exact: true }).fill("2048");
  control.conflict = true;
  const save = page.getByRole("button", { name: "保存设置", exact: true });
  await expect(save).toBeEnabled(); await save.click();
  await expect(page.getByRole("alert")).toContainText("你的草稿已保留");
  await expect(page.getByLabel(bufferLabel, { exact: true })).toHaveValue("2048");
  await page.getByRole("button", { name: "读取最新版本，保留草稿", exact: true }).click();
  await expect(page.getByLabel(bufferLabel, { exact: true })).toHaveValue("2048");
  control.fail = true;
  await expect(save).toBeEnabled(); await save.click();
  await expect(page.getByRole("button", { name: "重试上次操作", exact: true })).toBeVisible();
  await expect(page.getByLabel(bufferLabel, { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "重试上次操作", exact: true }).click();
  await expect(page.getByText("DSP 设置已保存，将在下一次播放生效。当前歌曲保持原配置。", { exact: true })).toBeVisible();
  expect(control.saves[1].key).toBe(control.saves[2].key);
  expect(control.saves[1].body.expectedRevision).toBe(4);
});

test("administrators edit global defaults and personal inheritance follows later updates", async ({ page }) => {
  const control = await mock(page, true);
  await page.goto(`${origin}/#/settings?tab=dsp`);
  await expect(page.getByLabel(bufferLabel, { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "全局默认 DSP", exact: true }).click();
  const global = page.locator(".dsp-settings:visible");
  await global.getByLabel(bufferLabel, { exact: true }).fill("8192");
  await expect(global.getByRole("button", { name: "保存设置", exact: true })).toBeEnabled();
  await global.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(global.getByText("DSP 设置已保存，将在下一次播放生效。当前歌曲保持原配置。", { exact: true })).toBeVisible();
  expect(control.saves[0].scope).toBe("global");
  await page.getByRole("button", { name: "我的 DSP", exact: true }).click();
  const personal = page.locator(".dsp-settings:visible");
  await expect(personal.getByLabel(bufferLabel, { exact: true })).toHaveValue("8192");
  await personal.getByLabel("使用全局配置", { exact: true }).uncheck();
  await personal.getByLabel(bufferLabel, { exact: true }).fill("1024");
  await expect(personal.getByRole("button", { name: "保存设置", exact: true })).toBeEnabled();
  await personal.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(personal.getByRole("button", { name: "保存设置", exact: true })).toBeDisabled();
  await personal.getByRole("button", { name: "恢复默认草稿", exact: true }).click();
  expect(control.saves).toHaveLength(2);
  await expect(personal.getByLabel("使用全局配置", { exact: true })).not.toBeChecked();
  await personal.getByLabel("使用全局配置", { exact: true }).check();
  await personal.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(personal.getByText("DSP 设置已保存，将在下一次播放生效。当前歌曲保持原配置。", { exact: true })).toBeVisible();
  expect(control.saves[2].body).toEqual({ expectedRevision: 4, schemaRevision: "dsp-settings-v1", inheritGlobal: true });
  await page.reload();
  await expect(page.getByLabel("使用全局配置", { exact: true })).toBeChecked();
  await expect(page.getByLabel(bufferLabel, { exact: true })).toHaveValue("8192");
});

test("unavailable DSP remains readable and explains why saving is unavailable", async ({ page }) => {
  const control = await mock(page);
  control.personal.available = false; control.personal.unavailableReason = "Audio processor unavailable";
  await openPersonal(page);
  await expect(page.getByText("Audio processor unavailable", { exact: true })).toBeVisible();
  await page.getByLabel(bufferLabel, { exact: true }).fill("512");
  await expect(page.getByRole("button", { name: "保存设置", exact: true })).toBeDisabled();
  expect(control.saves).toHaveLength(0);
});
