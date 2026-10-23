import { routeApi } from "../fixtures/control-mock";
import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { audioFixture } from "../fixtures/audio";
import { playback, track } from "../fixtures/dto";
import { mockPackages } from "./work-packages-mock";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const hidden = { ...track, sourceTrackId: "asmr/one", displayName: "归入作品.wav", providerInstanceId: "local" };
const ordinary = { ...track, sourceTrackId: "ordinary", displayName: "普通音乐.wav", providerInstanceId: "local" };
async function playerMock(page: Page) {
  const audio = audioFixture();
  const writes: unknown[] = [], deletes: string[] = [];
  await routeApi(page, async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/stream")) return route.fulfill({ contentType: "audio/wav", body: audio });
    if (request.method() === "POST") {
      writes.push(request.postDataJSON());
      return route.fulfill({ json: { ...playback("library-boundary"), outputProfile: { ...playback().outputProfile, channels: 1 } } });
    }
    if (request.method() === "DELETE") { deletes.push(path); return route.fulfill({ status: 204 }); }
    return route.fallback();
  }, "**/api/v1/playback/**");
  return { writes, deletes };
}
const playRow = (page: Page, name: string) => page.locator(".tracks").getByRole("button", { name: `播放 ${name}`, exact: true });

test("a confirmed package clears cached track rows even when the fresh list fails and preserves playback", async ({ page }) => {
  const state = await mockPackages(page);
  const player = await playerMock(page);
  let release!: () => void, freshRequested = false, failFresh = true;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/source-tracks?*", async (route) => {
    if (state.packages.length) {
      freshRequested = true; await gate;
      if (failFresh) return route.fulfill({ status: 503, json: { error: { code: "TEMPORARY_FAILURE" } } });
    }
    return route.fulfill({ json: { items: state.packages.length ? [ordinary] : [hidden, ordinary],
      libraryRevision: state.packages.length ? "2" : "1", nextCursor: null } });
  });
  await page.goto(`${origin}/#/library`);
  await playRow(page, hidden.displayName).click();
  const audio = page.locator("audio");
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.1);
  const original = await audio.elementHandle();
  await page.evaluate(() => { location.hash = "/works/one"; });
  await page.getByRole("button", { name: "导入本地副本", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入本地副本", exact: true });
  await dialog.getByRole("button", { name: "进入目录 RJ123456 雨夜", exact: true }).click();
  await dialog.getByRole("button", { name: "预览当前目录", exact: true }).click();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => { location.hash = "/library"; });
  await expect.poll(() => freshRequested).toBe(true);
  await expect(playRow(page, hidden.displayName)).toHaveCount(0);
  await expect(page.locator(".tracks tbody tr")).toHaveCount(0);
  release();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(playRow(page, hidden.displayName)).toHaveCount(0);
  failFresh = false;
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(playRow(page, ordinary.displayName)).toBeVisible();
  expect(await original!.evaluate((element) => element === document.querySelector("audio"))).toBe(true);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  expect(player.writes).toHaveLength(1); expect(player.deletes).toHaveLength(0);
});

test("a playlist resolves hidden source references directly and still plays them", async ({ page }) => {
  await mockPackages(page);
  const player = await playerMock(page);
  const reads: string[] = [];
  const playlist = { playlistId: "saved", name: "明确收藏", ruleRevision: 1, hideRevision: 1, snapshotRevision: 1, stale: false, bindings: [] };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/playlists") return route.fulfill({ json: { items: [playlist], nextAfter: null } });
    if (path === "/api/v1/playlists/saved") return route.fulfill({ json: playlist });
    if (path === "/api/v1/playlists/saved/snapshots/1") return route.fulfill({ json: {
      playlistId: "saved", revision: 1, nextOffset: null, needsConfirmation: [], items: [
        { entryId: "local-entry", source: { sourceTrackId: hidden.sourceTrackId, remoteSourceId: null }, provenance: [] },
        { entryId: "remote-entry", source: { sourceTrackId: null, remoteSourceId: "remote-one" }, provenance: [] },
      ],
    } });
    if (path.startsWith("/api/v1/source-tracks")) {
      reads.push(path);
      if (decodeURIComponent(path) === `/api/v1/source-tracks/${hidden.sourceTrackId}`) return route.fulfill({ json: hidden });
      return route.fulfill({ json: { items: [ordinary], libraryRevision: "2", nextCursor: null } });
    }
    return route.fallback();
  });
  await page.goto(`${origin}/#/playlists/saved`);
  await expect(playRow(page, hidden.displayName)).toBeVisible();
  await expect(page.getByText(/此快照另有 1 个远程或暂不可读取的来源引用/)).toBeVisible();
  await playRow(page, hidden.displayName).click();
  await expect.poll(() => page.locator("audio").evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.1);
  expect(player.writes).toEqual([expect.objectContaining({ sourceTrackId: hidden.sourceTrackId })]);
  expect(reads).toEqual(["/api/v1/source-tracks/asmr%2Fone"]);
});

test("legacy mixed album detail counts only visible music and enables play all", async ({ page }) => {
  await mockPackages(page);
  await page.route("**/api/v1/source-albums/*", (route) => route.fulfill({ json: {
    sourceAlbumId: "mixed", providerInstanceId: "local", name: "混合来源专辑", revision: 1,
    sourceTrackIds: [ordinary.sourceTrackId, hidden.sourceTrackId],
  } }));
  await page.route("**/api/v1/source-tracks?*", (route) => route.fulfill({ json: { items: [ordinary], libraryRevision: "2", nextCursor: null } }));
  await page.goto(`${origin}/#/albums/mixed`);
  await expect(page.getByRole("heading", { name: "混合来源专辑", exact: true })).toBeVisible();
  await expect(page.locator(".detail-heading")).toContainText("1 首");
  await expect(playRow(page, hidden.displayName)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "播放全部", exact: true })).toBeEnabled();
  await page.route("**/api/v1/source-tracks?*", (route) => route.fulfill({ json: { items: [], libraryRevision: "3", nextCursor: null } }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "暂无可读取的曲目", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "混合来源专辑", exact: true })).toHaveCount(0);
});
