import { test, expect, type Page, type Route } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import type { SourceTrack } from "../../src/api/types";
import type { TrackDetails } from "../../src/api/track-details";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const tracks: SourceTrack[] = ["Alpha", "Beta"].map((name) => ({ sourceTrackId: name, providerInstanceId: `source-${name}`,
  displayName: `${name}.flac`, title: name, artists: ["Library artist"], durationMs: 120000, codec: "flac", container: "flac",
  bitrateBps: null, availability: name === "Alpha" ? "available" : "unavailable", assetId: name, recordingId: "recording" }));
function pluginDetails(id: string): TrackDetails {
  return { sourceTrackId: id, providerInstanceId: `source-${id}`, externalId: `external-${id}`, title: `${id} 插件标题`,
    sections: [{ id: "catalog", title: "插件专有信息", fields: [
      { id: "edition", label: "发行批次", value: `${id}-2026` },
      { id: "notes", label: "插件备注", value: "第一行\n第二行" },
    ] }] };
}
const dialog = (page: Page) => page.getByRole("dialog", { name: "来源版本详情", exact: true });
const detailsButton = (page: Page, name: string) => page.getByRole("button", { name: `查看 ${name}.flac 的详情`, exact: true });
async function mockApi(page: Page, special: (route: Route, path: string) => Promise<boolean>) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await special(route, path)) return;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "details-mock" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "user", role: "admin" } };
    if (path.endsWith("/source-tracks")) json = { items: [{ ...tracks[0], versions: tracks }], libraryRevision: "1", matchingRevision: 0, nextCursor: null };
    if (path.endsWith("/provider-instances")) json = { items: tracks.map((track) => ({ id: track.providerInstanceId,
      name: `${track.sourceTrackId} 来源插件`, capabilities: [], availability: "available",
      plugin: { id: `plugin-${track.sourceTrackId}`, name: `${track.sourceTrackId} 来源插件`, localizedNames: {}, features: ["music-source"] } })) };
    if (path.endsWith("/matching/revision")) json = { revision: 0, bulkMergeAvailable: true };
    await route.fulfill({ json });
  });
  await page.goto(`${origin}/#/library`);
  await page.getByRole("button", { name: "展开 Alpha 的来源版本", exact: true }).click();
}

test("source plugin fields render as text on mobile even for an unavailable version", async ({ page }, info) => {
  const requests: string[] = [];
  const html = '<img src=x onerror="window.pluginMarkupExecuted=true">';
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, async (route, path) => {
    if (!path.endsWith("/details")) return false;
    requests.push(path);
    const details = pluginDetails("Beta");
    details.sections[0].fields.push({ id: "raw", label: "原始说明", value: html });
    details.sections[0].fields.push({ id: "long", label: "资源编号", value: "long-plugin-value-".repeat(30) });
    await route.fulfill({ json: details }); return true;
  });
  await expect(page.getByRole("button", { name: "播放来源版本 Beta.flac", exact: true })).toBeDisabled();
  await detailsButton(page, "Beta").click();
  await expect(dialog(page)).toContainText("Beta 插件标题");
  await expect(dialog(page)).toContainText("Beta 来源插件");
  await expect(dialog(page).getByRole("region", { name: "插件专有信息", exact: true })).toContainText("Beta-2026");
  await expect(dialog(page)).toContainText(html);
  await expect(dialog(page)).not.toContainText("Library artist");
  await expect(dialog(page).locator("img")).toHaveCount(0);
  expect(requests).toEqual(["/api/v1/source-tracks/Beta/details"]);
  expect(await dialog(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog(page).screenshot({ path: info.outputPath("source-details-mobile.png") });
});

test("plugin failures can be retried and empty plugin details have an explicit state", async ({ page }) => {
  let calls = 0;
  await mockApi(page, async (route, path) => {
    if (!path.endsWith("/details")) return false;
    calls++;
    if (calls === 1) await route.fulfill({ status: 503, json: { error: { code: "SOURCE_UNAVAILABLE" } } });
    else await route.fulfill({ json: { ...pluginDetails("Alpha"), sections: [] } });
    return true;
  });
  await detailsButton(page, "Alpha").click();
  await expect(dialog(page).getByRole("alert")).toContainText("来源暂不可用");
  await expect(dialog(page)).not.toContainText("Library artist");
  await dialog(page).getByRole("button", { name: "重试", exact: true }).click();
  await expect(dialog(page).getByRole("status")).toContainText("此来源插件暂未提供详细信息。");
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  expect(calls).toBe(2);
});

test("closing cancels a pending detail request and another version cannot show its late response", async ({ page }) => {
  let first: Route | null = null;
  await page.addInitScript(() => {
    const original = window.fetch;
    const aborted: string[] = [];
    Object.assign(window, { detailsAborted: aborted });
    window.fetch = (input, options) => {
      if (String(input).endsWith("/details")) options?.signal?.addEventListener("abort", () => aborted.push(String(input)), { once: true });
      return original(input, options);
    };
  });
  await mockApi(page, async (route, path) => {
    if (!path.endsWith("/details")) return false;
    if (path.endsWith("/Alpha/details")) first = route;
    else await route.fulfill({ json: pluginDetails("Beta") });
    return true;
  });
  await detailsButton(page, "Alpha").click();
  await expect(dialog(page).getByRole("status")).toContainText("正在加载");
  await expect.poll(() => first !== null).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(detailsButton(page, "Alpha")).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as unknown as { detailsAborted: string[] }).detailsAborted))
    .toContain("/api/v1/source-tracks/Alpha/details");
  await detailsButton(page, "Beta").click();
  await expect(dialog(page)).toContainText("Beta 插件标题");
  await (first as unknown as Route).fulfill({ json: pluginDetails("Alpha") }).catch(() => undefined);
  await expect(dialog(page)).not.toContainText("Alpha 插件标题");
  await expect(dialog(page)).toContainText("Beta-2026");
});

test("changed source files ask for a new scan instead of displaying stale library metadata", async ({ page }) => {
  await mockApi(page, async (route, path) => {
    if (!path.endsWith("/details")) return false;
    await route.fulfill({ status: 409, json: { error: { code: "RESOURCE_CHANGED" } } }); return true;
  });
  await detailsButton(page, "Alpha").click();
  await expect(dialog(page).getByRole("alert")).toContainText("来源文件已发生变化，请重新扫描曲库。");
  await expect(dialog(page)).not.toContainText("Library artist");
});

test("pending duplicate merges do not block reading source details", async ({ page }) => {
  await mockApi(page, async (route, path) => {
    if (path.endsWith("/matching/bulk-merge")) { await route.abort("failed"); return true; }
    if (path.endsWith("/details")) { await route.fulfill({ json: pluginDetails("Alpha") }); return true; }
    return false;
  });
  await page.getByRole("button", { name: "一键合并重复音乐", exact: true }).click();
  const merge = page.getByRole("dialog", { name: "一键合并重复音乐", exact: true });
  await merge.getByRole("button", { name: "开始合并", exact: true }).click();
  await expect(merge.getByRole("button", { name: "继续确认合并结果", exact: true })).toBeEnabled();
  await merge.getByRole("button", { name: "关闭", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "解除 Alpha.flac 的关联", exact: true })).toBeDisabled();
  await expect(detailsButton(page, "Alpha")).toBeEnabled();
  await detailsButton(page, "Alpha").click();
  await expect(dialog(page)).toContainText("Alpha 插件标题");
});
