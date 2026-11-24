import { musicPage, musicTrack } from "../fixtures/music-catalog";
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
const versionMenu = (page: Page, name: string) => page.getByRole("button", { name: `${name}.flac 的更多操作`, exact: true });
async function openDetails(page: Page, name: string) {
  await versionMenu(page, name).click();
  await page.getByRole("menuitem", { name: "详情", exact: true }).click();
}
async function mockApi(page: Page, special: (route: Route, path: string) => Promise<boolean>) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await special(route, path)) return;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "details-mock" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "user", role: "admin" } };
    if (path.endsWith("/library/tracks")) json = musicPage([{ ...tracks[0], versions: tracks }]);
    if (path.endsWith("/provider-instances")) json = { items: tracks.map((track) => ({ id: track.providerInstanceId,
      name: `${track.sourceTrackId} 来源插件`, capabilities: [], availability: "available",
      plugin: { id: `plugin-${track.sourceTrackId}`, name: `${track.sourceTrackId} 来源插件`, localizedNames: {}, features: ["music-source"] } })) };
    if (path.endsWith("/matching/revision")) json = { revision: 0 };
    await route.fulfill({ json });
  });
  await page.goto(`${origin}/#/library`);
  await page.getByRole("button", { name: "展开 Alpha 的来源版本", exact: true }).click();
}

test("the track menu opens a logical track and lyrics use the explicitly selected asset", async ({ page }) => {
  const pluginId = "example.lyrics";
  const localPlugin = "musicfs.scraper.local";
  const target = { sourceTrackId: "Alpha", assetId: "Alpha", assetVersion: "v2" };
  let attempts = 0;
  await mockApi(page, async (route, path) => {
    if (path.endsWith("/scrapers")) {
      await route.fulfill({ json: { items: [{ pluginId, name: "Lyrics", type: "scraper", available: true, fields: ["lyrics"] }] } });
    } else if (path.endsWith("/library/tracks/recording")) {
      await route.fulfill({ json: musicTrack({ ...tracks[0], versions: tracks }) });
    } else if (path.endsWith("/Alpha/media-selection")) {
      await route.fulfill({ json: { revision: 4, target, bindings: [] } });
    } else if (path.endsWith("/scrapers/lyrics-auto-search")) {
      const body = route.request().postDataJSON();
      expect(body.query).toMatchObject({ artist: "Library artist", title: "Alpha", duration: 120 });
      if (body.sourceTrackId) expect(body.sourceTrackId).toBe("Alpha");
      await route.fulfill({ json: { pluginId: body.sourceTrackId ? localPlugin : pluginId, items: [{
        id: "123", title: "Alpha", lyrics: body.sourceTrackId ? "[00:02]Local preview" : "[00:01]Automatic preview",
        candidateToken: body.sourceTrackId ? "local-token" : "auto-token",
      }] } });
    } else if (path.endsWith(`/scrapers/${pluginId}/search`)) {
      expect(route.request().postDataJSON()).toMatchObject({ field: "lyrics", query: { artist: "Library artist", title: "Alpha", duration: 120 } });
      await route.fulfill({ json: { items: [{ id: "123", title: "Alpha", lyrics: "[00:05]Lyric preview", candidateToken: "token" }] } });
    } else if (path.endsWith("/Alpha/scraped-fields/lyrics")) {
      expect(route.request().postDataJSON()).toEqual({ assetId: "Alpha", assetVersion: "v2", expectedRevision: 4, pluginId: localPlugin, candidateToken: "local-token" });
      attempts++;
      await route.fulfill({ json: { revision: 5, target, bindings: [] } });
    } else return false;
    return true;
  });
  const version = page.locator(".track-version").filter({ hasText: "Alpha.flac" });
  await expect(version.getByRole("button", { name: "搜索在线资料" })).toHaveCount(0);
  await version.getByRole("button", { name: "Alpha.flac 的更多操作" }).click();
  await expect(page.getByRole("menuitem", { name: "搜索在线资料" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Alpha 的更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "搜索在线资料" }).click();
  const search = page.getByRole("dialog", { name: "搜索在线资料" });
  const sources = search.getByRole("combobox", { name: "资料来源", exact: true });
  await expect(sources).toHaveValue("auto-lyrics");
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search.getByText("[00:01]Automatic preview")).toBeVisible();
  await sources.selectOption(pluginId);
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search.getByText("[00:05]Lyric preview")).toBeVisible();
  expect(attempts).toBe(0);
  await expect(search.getByRole("button", { name: "选用这项资料" })).toHaveCount(0);
  await search.getByLabel("保存到来源版本", { exact: true }).selectOption("Alpha");
  await sources.selectOption("auto-lyrics");
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search.getByText("[00:02]Local preview")).toBeVisible();
  await expect(search.getByText("歌词来源：本地歌词")).toBeVisible();
  await search.getByRole("button", { name: "选用这项资料" }).click();
  await expect(search).toHaveCount(0);
  expect(attempts).toBe(1);
});

for (const phase of ["load", "save"] as const) {
  for (const status of [404, 409]) {
    test(`a merged track on ${phase} (${status}) returns to the refreshed list`, async ({ page }) => {
      let merged = false, reads = 0, writes = 0;
      await mockApi(page, async (route, path) => {
        if (path.endsWith("/library/tracks") && merged) {
          await route.fulfill({ json: musicPage([{ ...tracks[0], recordingId: "merged-id", title: "Merged track" }]) });
        } else if (path.endsWith("/library/tracks/recording")) {
          const writing = route.request().method() === "PUT";
          if (writing) writes++; else reads++;
          if (phase === "load" || writing) {
            merged = true;
            await route.fulfill({ status, json: { error: { code: status === 404 ? "NOT_FOUND" : "RESOURCE_CHANGED" } } });
          } else await route.fulfill({ json: musicTrack({ ...tracks[0], versions: tracks }) });
        } else return false;
        return true;
      });
      await page.getByRole("button", { name: "Alpha 的更多操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "编辑曲目元数据" }).click();
      const editor = page.getByRole("dialog", { name: "编辑曲目元数据" });
      if (phase === "save") {
        await editor.getByLabel("曲名", { exact: true }).fill("Late edit");
        await editor.getByRole("button", { name: "保存", exact: true }).click();
        await expect(editor.getByLabel("曲名", { exact: true })).toBeDisabled();
      }
      await expect(editor.getByRole("alert")).toContainText("已被合并或移除");
      await editor.getByRole("button", { name: "刷新列表并重新选择" }).click();
      await expect(editor).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Merged track 的更多操作" })).toBeVisible();
      expect(reads).toBe(1); expect(writes).toBe(phase === "save" ? 1 : 0);
    });
  }
}

test("a metadata revision conflict reloads the same track in the editor", async ({ page }) => {
  let reads = 0;
  await mockApi(page, async (route, path) => {
    if (!path.endsWith("/library/tracks/recording")) return false;
    if (route.request().method() === "PUT") await route.fulfill({ status: 409, json: { error: { code: "REVISION_CONFLICT" } } });
    else await route.fulfill({ json: { ...musicTrack(tracks[0]), revision: ++reads, title: reads === 1 ? "Alpha" : "Current title" } });
    return true;
  });
  await page.getByRole("button", { name: "Alpha 的更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "编辑曲目元数据" }).click();
  const editor = page.getByRole("dialog", { name: "编辑曲目元数据" });
  await editor.getByLabel("曲名", { exact: true }).fill("Stale change");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.getByRole("button", { name: "刷新资料", exact: true }).click();
  await expect(editor.getByLabel("曲名", { exact: true })).toHaveValue("Current title");
  expect(reads).toBe(2);
});

test("a catalog-only track accepts platform titles and manual language edits without an asset", async ({ page }) => {
  const track = { ...musicTrack(tracks[0]), trackId: "unavailable", title: "打上花火", selectedSource: null,
    localizedTitles: [{ language: "zh-Hans", title: "烟花" }], revision: 4 };
  const missing = { ...musicPage([]), items: [track] };
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "track-mock" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "user", role: "admin" } };
    if (path.endsWith("/library/artists/artist")) json = { artistId: "artist", name: "Artist", namesRevision: 1 };
    if (path.endsWith("/library/tracks")) json = missing;
    if (path.endsWith("/library/tracks/unavailable")) {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        expect(body).toMatchObject({ expectedRevision: track.revision, title: "打上花火", artistNames: ["Library artist"] });
        track.localizedTitles = body.localizedTitles; track.revision++;
      }
      json = track;
    }
    if (path.endsWith("/scrapers")) json = { items: [{ pluginId: "platform", name: "Platform", type: "scraper", available: true, fields: ["trackDetails"] }] };
    if (path.endsWith("/scrapers/platform/search")) json = { items: [{ id: "12", title: "Uchiagehanabi",
      localizedTitles: [{ language: "ja-Latn", title: "Uchiagehanabi" }], candidateToken: "example" }] };
    expect(path).not.toMatch(/media-selection|source-tracks/);
    await route.fulfill({ json });
  });
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("歌手")}&categoryId=artist`);
  const more = page.getByRole("button", { name: "打上花火 的更多操作", exact: true });
  await more.click(); await page.getByRole("menuitem", { name: "搜索在线资料" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "搜索", exact: true }).click();
  await modal.getByRole("button", { name: "保存为曲目别名" }).click();
  await expect(modal).toHaveCount(0);
  expect(track.localizedTitles).toEqual([{ language: "zh-Hans", title: "烟花" }, { language: "ja-Latn", title: "Uchiagehanabi" }]);
  await more.click(); await page.getByRole("menuitem", { name: "编辑曲目元数据" }).click();
  await modal.getByRole("button", { name: "添加名称" }).click();
  await modal.getByLabel("语言标签").last().fill("en");
  await modal.getByLabel("别名", { exact: true }).last().fill("Fireworks");
  await modal.getByRole("button", { name: "保存", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(track.localizedTitles.at(-1)).toEqual({ language: "en", title: "Fireworks" });
});

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
  await openDetails(page, "Beta");
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
  await openDetails(page, "Alpha");
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
  await openDetails(page, "Alpha");
  await expect(dialog(page).getByRole("status")).toContainText("正在加载");
  await expect.poll(() => first !== null).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(versionMenu(page, "Alpha")).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as unknown as { detailsAborted: string[] }).detailsAborted))
    .toContain("/api/v1/source-tracks/Alpha/details");
  await openDetails(page, "Beta");
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
  await openDetails(page, "Alpha");
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
  await versionMenu(page, "Alpha").click();
  await expect(page.getByRole("menuitem", { name: "解除关联", exact: true })).toBeDisabled();
  await page.getByRole("menuitem", { name: "详情", exact: true }).click();
  await expect(dialog(page)).toContainText("Alpha 插件标题");
});
