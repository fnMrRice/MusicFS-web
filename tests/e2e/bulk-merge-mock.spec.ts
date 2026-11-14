import { musicPage } from "../fixtures/music-catalog";
import { test, expect, type Page, type Route } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import type { SourceTrack } from "../../src/api/types";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const tracks: SourceTrack[] = ["Alpha", "Beta"].map((name) => ({ sourceTrackId: name, providerInstanceId: "local",
  displayName: `${name}.flac`, title: name, artists: ["Artist"], durationMs: 120000, codec: "flac", container: "flac",
  bitrateBps: null, availability: "available", assetId: name, recordingId: null }));
const result = { revision: 1, operationId: "bulk", recordingId: null, mergedGroups: 1, mergedSources: 2, skippedGroups: 3 };
const entry = (page: Page) => page.getByRole("button", { name: "一键合并重复音乐", exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: "一键合并重复音乐", exact: true });
const submit = (page: Page) => dialog(page).getByRole("button", { name: "开始合并", exact: true });

async function mockApi(page: Page, special: (route: Route, path: string) => Promise<boolean>, capability = true) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await special(route, path)) return;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "bulk-mock" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "user", role: "admin" } };
    if (path.endsWith("/library/tracks")) json = musicPage(tracks.map((track) => ({ ...track, versions: [track] })));
    if (path.endsWith("/matching/revision")) json = { revision: 0, ...(capability ? { bulkMergeAvailable: true } : {}) };
    if (path.endsWith("/matching/candidates")) json = { items: [], revision: 0, nextAfter: null };
    await route.fulfill({ json });
  });
}

test("score merge validates thresholds and reports full-library counts on mobile", async ({ page }, info) => {
  const bodies: unknown[] = [];
  await mockApi(page, async (route, path) => {
    if (!path.endsWith("/matching/bulk-merge")) return false;
    bodies.push(route.request().postDataJSON()); await route.fulfill({ json: result }); return true;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/#/library?source=local`);
  await entry(page).click();
  await expect(dialog(page)).toContainText("不受当前来源筛选、已加载页或所选曲目限制");
  await expect(dialog(page).getByRole("radio", { name: "按分数合并", exact: true })).toBeChecked();
  const score = dialog(page).getByRole("spinbutton", { name: "最低分数（0–100）", exact: true });
  await expect(score).toHaveValue("80");
  for (const value of ["", "-1", "101", "90.5"]) {
    await score.fill(value); await expect(submit(page)).toBeDisabled();
  }
  await score.fill("0"); await expect(submit(page)).toBeEnabled();
  await score.fill("100"); await submit(page).click();
  await expect(dialog(page)).toContainText("已合并 1 组重复音乐，涉及 2 个来源版本。");
  await expect(dialog(page)).toContainText("已跳过 3 个");
  expect(bodies).toEqual([{ expectedRevision: 0, mode: "score", minimumScore: 100 }]);
  expect(await dialog(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog(page).screenshot({ path: info.outputPath("bulk-merge-result-mobile.png") });
});

test("title and artist mode works without a matching plugin or candidates and reports no matches", async ({ page }) => {
  const bodies: unknown[] = [];
  await mockApi(page, async (route, path) => {
    if (!path.endsWith("/matching/bulk-merge")) return false;
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ json: { ...result, mergedGroups: 0, mergedSources: 0, skippedGroups: 0 } }); return true;
  });
  await page.goto(`${origin}/#/library`); await entry(page).click();
  await dialog(page).getByRole("radio", { name: "合并重名重作者", exact: true }).check();
  await expect(dialog(page)).toContainText("曲名或作者为空的曲目不合并");
  await expect(dialog(page).getByRole("spinbutton")).toHaveCount(0);
  await submit(page).click();
  await expect(dialog(page)).toContainText("没有可合并的重复音乐。");
  expect(bodies).toEqual([{ expectedRevision: 0, mode: "title_artist" }]);
});

test("uncertain results lock parameters and other decisions and survive reload with the same request key", async ({ page }) => {
  const submissions: { body: unknown; key: string | undefined }[] = [];
  await mockApi(page, async (route, path) => {
    if (!path.endsWith("/matching/bulk-merge")) return false;
    submissions.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
    if (submissions.length === 1) await route.abort("failed"); else await route.fulfill({ json: result });
    return true;
  });
  await page.goto(`${origin}/#/library`); await entry(page).click();
  await dialog(page).getByRole("spinbutton").fill("91"); await submit(page).click();
  await expect(dialog(page).getByRole("button", { name: "继续确认合并结果", exact: true })).toBeEnabled();
  await expect(dialog(page).getByRole("spinbutton")).toBeDisabled();
  await expect(dialog(page).getByRole("radio", { name: "合并重名重作者", exact: true })).toBeDisabled();
  await dialog(page).getByRole("button", { name: "关闭", exact: true }).last().click();
  await expect(entry(page)).toBeDisabled();
  await page.getByRole("checkbox", { name: "选择 Alpha", exact: true }).check();
  await page.getByRole("checkbox", { name: "选择 Beta", exact: true }).check();
  await expect(page.getByRole("button", { name: "合并歌曲", exact: true })).toBeDisabled();
  await page.reload();
  await expect(entry(page)).toBeDisabled();
  await page.getByRole("button", { name: "继续确认关联结果", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已合并 1 组" })).toBeVisible();
  expect(submissions).toHaveLength(2); expect(submissions[0].key).toBeTruthy(); expect(submissions[1]).toEqual(submissions[0]);
  await expect(entry(page)).toBeEnabled();
});

test("a revision conflict requires review before submitting against a new revision", async ({ page }) => {
  let revision = 0; const submissions: { body: { expectedRevision: number }; key?: string }[] = [];
  await mockApi(page, async (route, path) => {
    if (path.endsWith("/matching/revision")) { await route.fulfill({ json: { revision, bulkMergeAvailable: true } }); return true; }
    if (!path.endsWith("/matching/bulk-merge")) return false;
    submissions.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
    if (submissions.length === 1) {
      revision = 4; await route.fulfill({ status: 409, json: { error: { code: "REVISION_CONFLICT" } } });
    } else await route.fulfill({ json: { ...result, revision: 5 } });
    return true;
  });
  await page.goto(`${origin}/#/library`); await entry(page).click(); await submit(page).click();
  await expect(dialog(page).getByRole("alert")).toContainText("已发生变化");
  await expect(submit(page)).toHaveCount(0); await expect(dialog(page).getByRole("spinbutton")).toBeDisabled();
  expect(submissions).toHaveLength(1);
  await dialog(page).getByRole("button", { name: "刷新曲库并重新确认", exact: true }).click();
  await expect(submit(page)).toBeEnabled(); await submit(page).click();
  await expect(dialog(page)).toContainText("已合并 1 组");
  expect(submissions.map((item) => item.body.expectedRevision)).toEqual([0, 4]);
  expect(submissions[1].key).not.toBe(submissions[0].key);
});

test("bulk merging continues across navigation and updates every cached library", async ({ page }) => {
  let submitRoute: Route | null = null; let merged = false;
  const refreshedSources = new Set<string>();
  await mockApi(page, async (route, path) => {
    if (path.endsWith("/matching/bulk-merge")) { submitRoute = route; return true; }
    if (!path.endsWith("/library/tracks")) return false;
    if (merged) refreshedSources.add(new URL(route.request().url()).searchParams.get("providerInstanceId") ?? "all");
    await route.fulfill({ json: musicPage(merged ? [{ ...tracks[0], recordingId: "recording", versions: tracks }] :
      tracks.map((track) => ({ ...track, versions: [track] })), "1", merged ? 1 : 0) });
    return true;
  });
  await page.goto(`${origin}/#/library?source=local`); await expect(entry(page)).toBeEnabled();
  await page.getByRole("button", { name: "展开作品库", exact: true }).click();
  await page.getByRole("link", { name: "曲目列表", exact: true }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(entry(page)).toBeEnabled();
  await page.evaluate(() => { window.location.hash = "/settings"; });
  await expect(entry(page)).toHaveCount(0);
  await page.getByRole("link", { name: "曲目列表", exact: true }).click();
  await entry(page).click(); await submit(page).click();
  await expect.poll(() => submitRoute !== null).toBe(true);
  await page.goBack(); await expect(dialog(page)).toHaveCount(0);
  merged = true; await (submitRoute as unknown as Route).fulfill({ json: result });
  await expect.poll(() => [...refreshedSources].sort()).toEqual(["all", "local"]);
  await page.getByRole("link", { name: "曲目列表", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已合并 1 组" })).toBeVisible();
  await expect(page.getByRole("button", { name: "展开 Alpha 的来源版本", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "选择 Beta", exact: true })).toHaveCount(0);
});

test("legacy matching servers do not advertise unsupported bulk merging", async ({ page }) => {
  await mockApi(page, async () => false, false);
  await page.goto(`${origin}/#/library`);
  await expect(page.getByRole("button", { name: "重复识别", exact: true })).toBeVisible();
  await expect(entry(page)).toHaveCount(0);
});

test("the bulk merge capability can be retried after a transient connection failure", async ({ page }) => {
  let requests = 0;
  await mockApi(page, async (route, path) => {
    if (!path.endsWith("/matching/revision")) return false;
    requests++;
    if (requests === 1) await route.abort("failed");
    else await route.fulfill({ json: { revision: 0, bulkMergeAvailable: true } });
    return true;
  });
  await page.goto(`${origin}/#/library`);
  await page.getByRole("button", { name: "重新检查一键合并功能", exact: true }).click();
  await expect(entry(page)).toBeEnabled();
});
