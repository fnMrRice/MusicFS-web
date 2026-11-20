import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { routeApi } from "../fixtures/control-mock";
import { musicPage } from "../fixtures/music-catalog";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const album = { albumId: "one", name: "夜间专辑", revision: 1, externalId: null,
  isExternal: false, coverPath: null, publisher: null, releaseDate: null };
const candidate = { id: "release-one", title: "夜间专辑发行版", sourceUrl: "https://example.org/release/one",
  tracks: [{ title: "第一曲", disc: 1, number: 1 }] };

async function mock(page: Page) {
  const state = { album: { ...album }, saved: [] as unknown[], conflict: false,
    searches: [] as Record<string, unknown>[], writes: [] as { path: string; body: Record<string, unknown>; key: string | undefined }[] };
  await routeApi(page, async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1", "");
    if (path === "/health/ready") return route.fulfill({ json: { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "album-test" } });
    if (path === "/auth/session") return route.fulfill({ json: { csrfToken: "csrf", user: { id: "listener", role: "user" } } });
    if (path === "/me/profile") return route.fulfill({ json: { user: { id: "listener", role: "user" }, nickname: "听众" } });
    if (path === "/library/tracks") return route.fulfill({ json: musicPage([]) });
    if (path === "/library/albums") return route.fulfill({ json: { items: [{ ...state.album, trackCount: 2 }], nextAfter: null } });
    if (path === "/library/albums/one") return route.fulfill({ json: state.album });
    if (path === "/library/albums/one/scraped-fields") return route.fulfill({ json: { items: state.saved } });
    if (path.startsWith("/library/albums/one/scraped-fields/")) {
      const body = request.postDataJSON();
      state.writes.push({ path, body, key: request.headers()["idempotency-key"] });
      if (state.conflict) {
        state.conflict = false; state.album.revision++;
        return route.fulfill({ status: 409, json: { error: { code: "CONFLICT" } } });
      }
      expect(body.expectedRevision).toBe(state.album.revision);
      state.saved = [{ field: path.split("/").at(-1), pluginId: body.pluginId, item: candidate }];
      state.album.revision++;
      return route.fulfill({ json: { revision: state.album.revision } });
    }
    if (path === "/scrapers") return route.fulfill({ json: { items: [
      { pluginId: "album-source", name: "专辑资料源", type: "scraper", available: true, fields: ["albumDetails", "albumTracks", "artwork", "lyrics", "artistImage"] },
      { pluginId: "lyrics-source", name: "歌词资料源", type: "scraper", available: true, fields: ["lyrics"] },
    ] } });
    if (path === "/scrapers/album-source/search") {
      state.searches.push(request.postDataJSON());
      return route.fulfill({ json: { items: [{ ...candidate, candidateToken: "candidate-token" }] } });
    }
    return route.fulfill({ json: { items: [], nextAfter: null, nextCursor: null, libraryRevision: "1" } });
  });
  return state;
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "搜索在线资料", exact: true });
async function openAlbum(page: Page) {
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}`);
  await page.getByRole("button", { name: "夜间专辑 2 首" }).click();
  await page.getByRole("button", { name: "搜索在线资料", exact: true }).click();
}

test("album browsing searches only album fields and persists a selected track list across reloads", async ({ page }, info) => {
  const state = await mock(page);
  await openAlbum(page);
  const modal = dialog(page);
  await expect(modal.getByLabel("标题或关键词", { exact: true })).toHaveValue(album.name);
  await expect(modal.getByRole("combobox", { name: "刮削内容", exact: true }).locator("option")).toHaveText(["专辑详情", "专辑曲目", "专辑封面"]);
  await expect(modal.getByRole("combobox", { name: "资料来源", exact: true }).locator("option")).toHaveText(["专辑资料源"]);
  await modal.getByRole("combobox", { name: "刮削内容", exact: true }).selectOption("albumTracks");
  await modal.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(modal.getByText("第一曲", { exact: true })).toBeVisible();
  expect(state.saved).toEqual([]);
  await modal.getByRole("button", { name: "选用这项资料", exact: true }).click();
  await expect(modal).toHaveCount(0);
  const saved = page.getByRole("region", { name: "刮削资料", exact: true });
  await expect(saved.getByText("夜间专辑发行版", { exact: false })).toBeVisible();
  expect(state.searches).toEqual([{ field: "albumTracks", query: { title: album.name } }]);
  expect(state.writes).toEqual([{ path: "/library/albums/one/scraped-fields/albumTracks",
    body: { expectedRevision: 1, pluginId: "album-source", candidateToken: "candidate-token" }, key: expect.any(String) }]);
  await page.reload();
  await saved.locator("summary").click();
  await expect(saved.getByText("第一曲", { exact: true })).toBeVisible();
  await expect(saved.getByRole("link", { name: "查看来源页面", exact: true })).toHaveAttribute("href", candidate.sourceUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("album-scraping-mobile.png") });
});

test("a conflicting album selection refreshes the observed revision before another search", async ({ page }) => {
  const state = await mock(page);
  state.conflict = true;
  await openAlbum(page);
  await dialog(page).getByRole("button", { name: "搜索", exact: true }).click();
  await dialog(page).getByRole("button", { name: "选用这项资料", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toBeVisible();
  await dialog(page).getByRole("button", { name: "刷新资料", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "搜索在线资料", exact: true }).click();
  await dialog(page).getByRole("button", { name: "搜索", exact: true }).click();
  await dialog(page).getByRole("button", { name: "选用这项资料", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes.map((write) => write.body.expectedRevision)).toEqual([1, 2]);
});

test("the unknown album category does not offer a shared scraping target", async ({ page }) => {
  await mock(page);
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}&unknownCategory=1`);
  await expect(page.getByRole("heading", { name: "未知专辑", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "搜索在线资料", exact: true })).toHaveCount(0);
});
