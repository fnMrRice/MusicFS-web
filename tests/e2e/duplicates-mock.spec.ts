import { musicPage } from "../fixtures/music-catalog";
import { routeApi } from "../fixtures/control-mock";
import { test, expect, type Page, type Route } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import type { PluginSettings } from "../../src/api/plugin-settings";
import type { SourceTrack } from "../../src/api/types";

let server: PreviewServer;
const origin = "http://127.0.0.1:18149";
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18149, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const tracks: SourceTrack[] = ["Alpha", "Beta"].map((name) => ({ sourceTrackId: name, providerInstanceId: "local",
  displayName: `${name}.flac`, title: name, artists: ["Artist"], durationMs: 120000, codec: "flac", container: "flac",
  bitrateBps: null, availability: "available", assetId: name, recordingId: null }));
const pluginId = "third.party.example";
function pluginSettings(): PluginSettings {
  return { pluginId, revision: 4, values: { enabled: true, query: "old", threshold: 1, mode: "fast" }, schema: {
    revision: "custom-v2", title: "自定义识别设置", description: "这个设置页面由插件声明。",
    fields: [
      { key: "enabled", type: "checkbox", label: "启用自动分析", defaultValue: true },
      { key: "query", type: "text", label: "分析关键字", defaultValue: "", maxLength: 20 },
      { key: "threshold", type: "number", label: "相似分数", defaultValue: 1, min: 1, max: 10, step: 1 },
      { key: "mode", type: "select", label: "分析方式", defaultValue: "fast", options: [{ value: "fast", label: "快速" }, { value: "full", label: "完整" }] },
    ], actions: [{ id: "analyze", label: "立即分析", description: "使用已保存的设置进行分析。" }],
  }, job: { jobId: null, status: "idle", processed: 0, total: 0, errorCode: null, updatedAt: null } };
}

async function mockApi(page: Page, special: (route: Route, path: string) => Promise<boolean>, plugin = false) {
  return routeApi(page, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await special(route, path)) return;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "duplicates-mock" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "user", role: "admin" } };
    if (path.endsWith("/library/tracks")) json = musicPage(tracks.map((track) => ({ ...track, versions: [track] })));
    if (path.endsWith("/admin/plugins")) json = { items: plugin ? [{ pluginId, version: "1", settingsAvailable: true,
      plugin: { id: pluginId, name: "自定义工具", localizedNames: {}, features: ["recording-matching"] }, supportsMultipleInstances: false, instances: [] }] : [] };
    await route.fulfill({ json });
  });
}

test("manual merge works without a matching plugin and a conflict requires reselecting", async ({ page }) => {
  let posts = 0; let revision = 0; let merged = false;
  await mockApi(page, async (route, path) => {
    if (path.endsWith("/matching/links")) {
      posts++;
      const request = route.request().postDataJSON();
      expect(request.expectedRevision).toBe(revision);
      if (posts === 1) {
        revision = 1;
        await route.fulfill({ status: 409, json: { error: { code: "REVISION_CONFLICT" } } });
      } else {
        merged = true; revision = 2;
        await route.fulfill({ json: { revision, recordingId: "recording", operationId: "link" } });
      }
      return true;
    }
    if (path.endsWith("/library/tracks")) {
      await route.fulfill({ json: musicPage(merged ? [{ ...tracks[0], recordingId: "recording", versions: tracks }] : tracks.map((track) => ({ ...track, versions: [track] })), "1", revision) });
      return true;
    }
    return false;
  });
  await page.goto(`${origin}/#/library`);
  const select = async () => {
    await page.getByRole("checkbox", { name: "选择 Alpha", exact: true }).check();
    await page.getByRole("checkbox", { name: "选择 Beta", exact: true }).check();
    await page.getByRole("button", { name: "合并歌曲", exact: true }).click();
  };
  await select();
  const dialog = page.getByRole("dialog", { name: "合并歌曲", exact: true });
  await dialog.getByRole("button", { name: "确认合并", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("已发生变化");
  await expect(dialog.getByRole("button", { name: "确认合并", exact: true })).toHaveCount(0);
  expect(posts).toBe(1);
  await dialog.getByRole("button", { name: "刷新列表并重新选择", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await select();
  await dialog.getByRole("button", { name: "确认合并", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "选择 Beta", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "展开 Alpha 的来源版本", exact: true }).click();
  await expect(page.getByLabel("来源版本", { exact: true }).getByRole("button", { name: /^播放来源版本/ })).toHaveCount(2);
  expect(posts).toBe(2);
});

test("arbitrary plugin declarations render all controls and keep an uncertain action's idempotency key", async ({ page }, info) => {
  let settings = pluginSettings();
  const submissions: { body: unknown; key: string | undefined }[] = [];
  const control = await mockApi(page, async (route, path) => {
    if (!path.startsWith(`/api/v1/plugin-settings/${pluginId}`)) return false;
    if (path.endsWith("/actions/analyze")) {
      submissions.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
      if (submissions.length === 1) await route.abort("failed");
      else {
        settings = { ...settings, job: { jobId: "analysis", status: "running", processed: 2, total: 10, candidates: 1, errorCode: null, updatedAt: null } };
        await route.fulfill({ json: settings.job });
      }
    } else if (route.request().method() === "PUT") {
      const request = route.request().postDataJSON();
      expect(request).toEqual({ expectedRevision: 4, schemaRevision: "custom-v2", values: { enabled: false, query: "live", threshold: 6, mode: "full" } });
      settings = { ...settings, revision: 5, values: request.values };
      await route.fulfill({ json: settings });
    } else await route.fulfill({ json: settings });
    return true;
  }, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/#/settings?tab=plugins`);
  await page.getByRole("button", { name: "配置 自定义工具", exact: true }).click();
  const panel = page.getByRole("region", { name: "自定义识别设置", exact: true });
  await panel.getByLabel("启用自动分析", { exact: true }).uncheck();
  await panel.getByLabel("分析关键字", { exact: true }).fill("live");
  await panel.getByLabel("相似分数", { exact: true }).fill("6");
  await panel.getByLabel("分析方式", { exact: true }).selectOption("full");
  await expect(panel.getByRole("button", { name: "立即分析", exact: true })).toBeDisabled();
  await expect(panel).toContainText("请先保存修改");
  await panel.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(panel.getByRole("button", { name: "立即分析", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "立即分析", exact: true }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.getByRole("button", { name: "重试上次操作", exact: true }).click();
  await expect(panel).toContainText("已处理 2 / 10 首曲目");
  expect(submissions).toHaveLength(2); expect(submissions[0].key).toBeTruthy(); expect(submissions[1]).toEqual(submissions[0]);
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await panel.screenshot({ path: info.outputPath("declarative-plugin-settings-mobile.png") });
  await page.reload();
  await page.getByRole("button", { name: "配置 自定义工具", exact: true }).click();
  await expect(panel).toContainText("已处理 2 / 10 首曲目");
  await panel.getByLabel("分析关键字", { exact: true }).fill("draft");
  settings = { ...settings, job: { ...settings.job!, status: "succeeded", processed: 10 } };
  control.event("activity.changed", { resources: ["pluginJobs"] });
  await expect(panel).toContainText("已处理 10 / 10 首曲目");
  await expect(panel.getByLabel("分析关键字", { exact: true })).toHaveValue("draft");
  expect(submissions).toHaveLength(2);
});

test("a merge continues after back navigation and refreshes the cached library", async ({ page }) => {
  let merged = false;
  let submitRoute: Route | null = null;
  await mockApi(page, async (route, path) => {
    if (path.endsWith("/matching/links")) { submitRoute = route; return true; }
    if (path.endsWith("/library/tracks")) {
      await route.fulfill({ json: musicPage(merged ? [{ ...tracks[0], recordingId: "recording", versions: tracks }] : tracks.map((track) => ({ ...track, versions: [track] })), "1", merged ? 1 : 0) });
      return true;
    }
    return false;
  });
  await page.goto(`${origin}/#/settings`);
  await page.getByRole("button", { name: "展开作品库", exact: true }).click();
  await page.getByRole("link", { name: "曲目列表", exact: true }).click();
  await page.getByRole("checkbox", { name: "选择 Alpha", exact: true }).check();
  await page.getByRole("checkbox", { name: "选择 Beta", exact: true }).check();
  await page.getByRole("button", { name: "合并歌曲", exact: true }).click();
  await page.getByRole("dialog", { name: "合并歌曲", exact: true }).getByRole("button", { name: "确认合并", exact: true }).click();
  await expect.poll(() => submitRoute !== null).toBe(true);
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "合并歌曲", exact: true })).toHaveCount(0);
  merged = true;
  await (submitRoute as unknown as Route).fulfill({ json: { revision: 1, recordingId: "recording", operationId: "background-link" } });
  await page.getByRole("link", { name: "曲目列表", exact: true }).click();
  await expect(page.getByRole("button", { name: "展开 Alpha 的来源版本", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "选择 Beta", exact: true })).toHaveCount(0);
});
