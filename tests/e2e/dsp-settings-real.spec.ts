import { expect, test, type Locator, type Page } from "@playwright/test";
import { existsSync, writeFileSync } from "node:fs";
import { startDirectoryServer, type DirectoryTestServer } from "./directory-server";
import { login } from "./helpers";
import { yamlFixture } from "../fixtures/config-yaml";
import { instanceIds } from "../fixtures/plugins";
import type { DSPSettingsPage } from "../../src/api/dsp";

let server: DirectoryTestServer | undefined;
const ffmpeg = process.env.MUSICFS_E2E_FFMPEG ?? "D:/Software/MultiMedia/ffmpeg-6.1.1-full_build-shared/bin/ffmpeg.exe";
const ffprobe = process.env.MUSICFS_E2E_FFPROBE ?? "D:/Software/MultiMedia/ffmpeg-6.1.1-full_build-shared/bin/ffprobe.exe";
test.afterEach(async () => { await server?.stop(); server = undefined; });

async function save(page: Page, editor: Locator, global = false) {
  const button = editor.getByRole("button", { name: "保存设置", exact: true });
  await expect(button).toBeEnabled();
  const path = global ? "/dsp/settings/global" : "/dsp/settings";
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url().endsWith(path) && item.request().method() === "PUT"), button.click(),
  ]);
  expect(response.status(), await response.text()).toBe(200);
  await expect(button).toBeDisabled();
  return await response.json() as DSPSettingsPage;
}

async function openServer(page: Page, origin: string) {
  await page.goto(`${origin}/#/settings?tab=dsp`);
  await page.getByRole("button", { name: "服务端格式转换", exact: true }).click();
}

test("real server only exposes channel conversion and persists global and personal output layouts", async ({ page }, info) => {
  test.setTimeout(180_000);
  test.skip(!existsSync(ffmpeg) || !existsSync(ffprobe), "Set MUSICFS_E2E_FFMPEG and MUSICFS_E2E_FFPROBE to installed binaries");
  server = await startDirectoryServer();
  const plugin = yamlFixture({ plugins: [{ pluginId: "musicfs.plugin.decoder.ffmpeg", execution: "builtin", enabled: true,
    instances: [{ instanceId: instanceIds.ffmpeg, enabled: true, config: { ffmpegPath: ffmpeg, ffprobePath: ffprobe } }],
  }] });
  // 目录夹具的 plugins 是最后一个字段，此处仅扩展测试拥有的 YAML 列表。
  writeFileSync(server.configPath, server.configuration + plugin.slice(plugin.indexOf("\n") + 1));
  await server.restart();
  await login(page, server);
  await openServer(page, server.origin);
  const initial = await (await page.request.get(`${server.origin}/api/v1/dsp/settings`)).json() as DSPSettingsPage;
  expect(initial.available).toBe(true);
  expect(initial.catalog).toEqual([]);
  await expect(page.getByLabel("使用全局配置", { exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "添加效果", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "全局格式转换", exact: true }).click();
  const editor = page.locator(".server-dsp-settings:visible");
  await editor.getByLabel("输出声道", { exact: true }).selectOption("5.1");
  const global = await save(page, editor, true);
  expect(global).toMatchObject({ scope: "global", usesGlobal: false, settings: { outputLayout: "5.1", chain: [] } });
  await page.getByRole("button", { name: "我的格式转换", exact: true }).click();
  await expect(editor.getByLabel("输出声道", { exact: true })).toHaveValue("5.1");
  await editor.getByLabel("使用全局配置", { exact: true }).uncheck();
  await editor.getByLabel("输出声道", { exact: true }).selectOption("stereo");
  expect(await save(page, editor)).toMatchObject({ usesGlobal: false, settings: { outputLayout: "stereo", chain: [] } });
  await page.reload();
  await page.getByRole("button", { name: "服务端格式转换", exact: true }).click();
  await expect(editor.getByLabel("输出声道", { exact: true })).toHaveValue("stereo");
  await expect(editor.getByLabel("使用全局配置", { exact: true })).not.toBeChecked();
  await editor.getByLabel("使用全局配置", { exact: true }).check();
  expect(await save(page, editor)).toMatchObject({ usesGlobal: true, settings: { outputLayout: "5.1", chain: [] } });
  const read = await (await page.request.get(`${server.origin}/api/v1/dsp/settings`)).json() as DSPSettingsPage;
  expect(read.settings).toEqual(global.settings);
  await server.restart();
  await page.reload();
  await page.getByRole("button", { name: "服务端格式转换", exact: true }).click();
  await expect(editor.getByLabel("使用全局配置", { exact: true })).toBeChecked();
  await expect(editor.getByLabel("输出声道", { exact: true })).toHaveValue("5.1");
  await page.screenshot({ path: info.outputPath("dsp-real-format-inherited.png") });
});
