import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { routeApi } from "../fixtures/control-mock";
import { musicPage, musicTrack } from "../fixtures/music-catalog";
import { track } from "../fixtures/dto";
import type { SavedScrapedField } from "../../src/api/scrapers";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const album = { albumId: "one", originalName: "原始夜间专辑", name: "夜间专辑", revision: 1, externalId: null,
  isExternal: false, coverPath: null, publisher: null, releaseDate: null };
const candidate = { id: "release-one", title: "夜间专辑发行版", sourceUrl: "https://example.org/release/one",
  artist: "河图", album: album.name, date: "2013-04-02T07:00:00Z", publisher: "星河唱片",
  genre: "Mandopop", description: "适合夜间聆听的作品。" };
const completeCandidate = { ...candidate, tracks: [{ title: "第一曲", disc: 1, number: 1 },
  { title: "未收录曲目", disc: 1, number: 3 }] };
const tracks = ["第一曲", "第二曲"].map((title, index) => ({ ...track, title, displayName: `${title}.flac`,
  sourceTrackId: `album-track-${index}`, artists: [candidate.artist], album: album.name, codec: "flac", container: "flac" }));
const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#233c5d"/><stop offset="1" stop-color="#111f35"/></linearGradient></defs><rect width="160" height="160" fill="url(#bg)"/><circle cx="115" cy="42" r="21" fill="#e2c68b"/><path d="M0 105 Q45 70 85 108 T160 99 V160 H0Z" fill="#3c6982"/><path d="M0 130 Q50 100 92 133 T160 125 V160 H0Z" fill="#243e57"/></svg>`;

async function mock(page: Page, { empty = false, coverPath = "/api/v1/media/album-artwork", brokenCover = false }:
  { empty?: boolean; coverPath?: string | null; brokenCover?: boolean } = {}) {
  const state = { album: { ...album, coverPath }, saved: [] as SavedScrapedField[], conflict: false,
    applied: false, trackSearchFailure: false, reads: [] as string[],
    searches: [] as Record<string, unknown>[], writes: [] as { path: string; body: Record<string, unknown>; key: string | undefined }[] };
  await routeApi(page, async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1", "");
    if (request.method() === "GET") state.reads.push(path);
    if (path === "/media/album-artwork") return brokenCover ? route.fulfill({ status: 404 })
      : route.fulfill({ contentType: "image/svg+xml", body: artwork });
    if (path === "/health/ready") return route.fulfill({ json: { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "album-test" } });
    if (path === "/auth/session") return route.fulfill({ json: { csrfToken: "csrf", user: { id: "listener", role: "user" } } });
    if (path === "/me/profile") return route.fulfill({ json: { user: { id: "listener", role: "user" }, nickname: "听众" } });
    if (path === "/me/favorites") return route.fulfill({ json: { items: [], nextCursor: null, revision: "1" } });
    if (path === "/provider-instances") return route.fulfill({ json: { items: [{ id: track.providerInstanceId,
      name: "本地音乐", capabilities: [], availability: "available", roots: [] }] } });
    if (path === "/library/tracks") {
      const items = musicPage(empty ? [] : tracks).items;
      if (state.applied) items.push({ ...musicTrack(tracks[0]), trackId: "unavailable-online-track", title: "未收录曲目", selectedSource: null });
      return route.fulfill({ json: { ...musicPage([]), items } });
    }
    if (path === "/library/albums") return route.fulfill({ json: { items: [{ ...state.album,
      trackCount: (empty ? 0 : 2) + (state.applied ? 1 : 0) }], nextAfter: null } });
    if (path === "/library/albums/one") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        state.writes.push({ path, body, key: request.headers()["idempotency-key"] });
        expect(body.expectedRevision).toBe(state.album.revision);
        expect(body.originalName).toBeUndefined();
        state.album = { ...state.album, ...body, revision: state.album.revision + 1 };
      }
      return route.fulfill({ json: state.album });
    }
    if (path === "/library/albums/one/scraped-fields" && request.method() === "GET")
      return route.fulfill({ json: { items: state.saved } });
    if (path === "/library/albums/one/scraped-fields" && request.method() === "PUT") {
      const body = request.postDataJSON();
      state.writes.push({ path, body, key: request.headers()["idempotency-key"] });
      if (state.conflict) {
        state.conflict = false; state.album.revision++;
        return route.fulfill({ status: 409, json: { error: { code: "CONFLICT" } } });
      }
      expect(body.expectedRevision).toBe(state.album.revision);
      expect(body.candidates).toEqual({ albumDetails: "details-token", albumTracks: "tracks-token" });
      state.saved = [{ field: "albumDetails", pluginId: body.pluginId, item: candidate },
        { field: "albumTracks", pluginId: body.pluginId, item: completeCandidate }];
      state.applied = true;
      state.album.revision++;
      return route.fulfill({ json: { revision: state.album.revision } });
    }
    if (path === "/scrapers") return route.fulfill({ json: { items: [
      { pluginId: "album-source", name: "专辑资料源", type: "scraper", available: true, fields: ["albumDetails", "albumTracks", "artwork", "lyrics", "artistImage"] },
      { pluginId: "lyrics-source", name: "歌词资料源", type: "scraper", available: true, fields: ["lyrics"] },
      { pluginId: "details-source", name: "仅详情来源", type: "scraper", available: true, fields: ["albumDetails"] },
    ] } });
    if (path === "/scrapers/album-source/search") {
      const body = request.postDataJSON();
      state.searches.push(body);
      if (body.field === "albumTracks" && state.trackSearchFailure)
        return route.fulfill({ status: 503, json: { error: { code: "SOURCE_UNAVAILABLE" } } });
      return route.fulfill({ json: { items: [{ ...(body.field === "albumTracks" ? completeCandidate : candidate),
        candidateToken: body.field === "albumTracks" ? "tracks-token" : "details-token" }] } });
    }
    return route.fulfill({ json: { items: [], nextAfter: null, nextCursor: null, libraryRevision: "1" } });
  });
  return state;
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "搜索在线资料", exact: true });
const details = (page: Page) => page.getByRole("region", { name: "专辑详情", exact: true });
const detailsToggle = (page: Page) => page.getByRole("button", { name: "专辑详情", exact: true });
const scraping = (page: Page) => page.getByRole("button", { name: "搜索在线资料", exact: true });
async function openAlbum(page: Page, search = true) {
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}`);
  await page.getByRole("button", { name: /^夜间专辑 \d+ 首$/ }).click();
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "false");
  if (search) await scraping(page).click();
}

test("album browsing previews the complete release and saves metadata and missing tracks together", async ({ page }, info) => {
  const state = await mock(page);
  await openAlbum(page);
  const modal = dialog(page);
  await expect(modal.getByLabel("专辑名称", { exact: true })).toHaveValue(album.originalName);
  await expect(modal.getByRole("combobox", { name: "刮削内容", exact: true })).toHaveCount(0);
  await expect(modal.getByRole("combobox", { name: "资料来源", exact: true }).locator("option")).toHaveText(["专辑资料源"]);
  await modal.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(modal.getByRole("button", { name: "选用这张专辑", exact: true })).toHaveCount(0);
  await modal.getByRole("button", { name: "预览完整专辑", exact: true }).click();
  await expect(modal.getByText("第一曲", { exact: true })).toBeVisible();
  expect(state.saved).toEqual([]);
  await expect(modal.getByText("未收录曲目", { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "选用这张专辑", exact: true }).click();
  await expect(modal).toHaveCount(0);
  const saved = details(page);
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(saved.getByText("第一曲", { exact: true })).toBeVisible();
  expect(state.searches).toEqual([{ field: "albumDetails", query: { title: album.originalName } },
    { field: "albumTracks", query: { externalId: candidate.id, sourceUrl: candidate.sourceUrl } }]);
  expect(state.writes).toEqual([{ path: "/library/albums/one/scraped-fields",
    body: { expectedRevision: 1, pluginId: "album-source", candidates: { albumDetails: "details-token", albumTracks: "tracks-token" } },
    key: expect.any(String) }]);
  const added = page.locator(".tracks tbody tr").filter({ hasText: "未收录曲目" });
  await expect(added).toHaveClass(/source-missing/);
  await expect(added.getByRole("button", { name: "播放 未收录曲目", exact: true })).toBeDisabled();
  await page.reload();
  await expect(saved).toHaveCount(0);
  await detailsToggle(page).click();
  await expect(saved.getByText("第一曲", { exact: true })).toBeVisible();
  await expect(saved.getByRole("link", { name: "在平台查看", exact: true }).first()).toHaveAttribute("href", candidate.sourceUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("album-scraping-mobile.png") });
});

test("a conflicting album selection refreshes the observed revision before another search", async ({ page }) => {
  const state = await mock(page);
  state.conflict = true;
  await openAlbum(page);
  await dialog(page).getByRole("button", { name: "搜索", exact: true }).click();
  await dialog(page).getByRole("button", { name: "预览完整专辑", exact: true }).click();
  await dialog(page).getByRole("button", { name: "选用这张专辑", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toBeVisible();
  await dialog(page).getByRole("button", { name: "刷新资料", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "搜索在线资料", exact: true }).click();
  await dialog(page).getByRole("button", { name: "搜索", exact: true }).click();
  await dialog(page).getByRole("button", { name: "预览完整专辑", exact: true }).click();
  await dialog(page).getByRole("button", { name: "选用这张专辑", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes.map((write) => write.body.expectedRevision)).toEqual([1, 2]);
});

test("a failed complete track lookup never partially saves the release and can be retried", async ({ page }) => {
  const state = await mock(page);
  const previous = { field: "albumDetails", pluginId: "previous-source", item: { ...candidate, description: "原来保存的资料" } };
  state.saved = [previous];
  state.trackSearchFailure = true;
  await openAlbum(page);
  await dialog(page).getByRole("button", { name: "搜索", exact: true }).click();
  await dialog(page).getByRole("button", { name: "预览完整专辑", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "选用这张专辑", exact: true })).toHaveCount(0);
  expect(state.saved).toEqual([previous]);
  expect(state.writes).toEqual([]);
  state.trackSearchFailure = false;
  await dialog(page).getByRole("button", { name: "预览完整专辑", exact: true }).click();
  await expect(dialog(page).getByText("未收录曲目", { exact: true })).toBeVisible();
  await dialog(page).getByRole("button", { name: "选用这张专辑", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.saved.map((field) => field.field)).toEqual(["albumDetails", "albumTracks"]);
});

test("a manually supplied platform album page is sent to the selected server scraper", async ({ page }) => {
  const state = await mock(page);
  await openAlbum(page);
  await dialog(page).getByLabel("专辑名称", { exact: true }).fill("");
  await dialog(page).getByLabel("平台专辑页面（可选）", { exact: true }).fill(` ${candidate.sourceUrl} `);
  await dialog(page).getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog(page).getByRole("button", { name: "预览完整专辑", exact: true })).toBeVisible();
  expect(state.searches).toEqual([{ field: "albumDetails", query: { sourceUrl: candidate.sourceUrl } }]);
  expect(state.writes).toEqual([]);
});

test("editing the display name preserves the immutable original album name and saved metadata", async ({ page }) => {
  const state = await mock(page);
  state.saved = [{ field: "albumDetails", pluginId: "album-source", item: candidate }];
  await openAlbum(page, false);
  await detailsToggle(page).click();
  await details(page).getByRole("button", { name: "编辑资料", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑专辑资料", exact: true });
  const original = editor.getByLabel("原名", { exact: true });
  await expect(original).toHaveValue(album.originalName);
  await expect(original).toHaveAttribute("readonly", "");
  await expect(editor.getByLabel("发行商", { exact: true })).toHaveValue(candidate.publisher);
  await expect(editor.getByLabel("发行日期", { exact: true })).toHaveValue("2013-04-02");
  await editor.getByLabel("显示名", { exact: true }).fill("手动命名的专辑");
  await editor.getByLabel("发行商", { exact: true }).fill("手动发行商");
  await editor.getByLabel("发行日期", { exact: true }).fill("2020-02-01");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "手动命名的专辑", exact: true })).toBeVisible();
  expect(state.album.originalName).toBe(album.originalName);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ path: "/library/albums/one", body: {
    expectedRevision: 1, name: "手动命名的专辑", publisher: "手动发行商", releaseDate: "2020-02-01" } });
  await expect(details(page).getByText(candidate.description, { exact: true })).toBeVisible();
  await expect(details(page).getByText("2020/2/1", { exact: true })).toBeVisible();
});

test("the unknown album category does not offer a shared scraping target", async ({ page }) => {
  await mock(page);
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}&unknownCategory=1`);
  await expect(page.getByRole("heading", { name: "未知专辑", exact: true })).toBeVisible();
  await expect(scraping(page)).toHaveCount(0);
  await expect(detailsToggle(page)).toHaveCount(0);
});

test("album details stay collapsed and the scraping action remains beside sorting during selection", async ({ page }, info) => {
  const state = await mock(page);
  state.saved = [{ field: "albumDetails", pluginId: "album-source", item: candidate }];
  await page.emulateMedia({ colorScheme: "dark" });
  await openAlbum(page, false);
  await expect(details(page)).toHaveCount(0);
  const heading = await page.getByRole("heading", { name: album.name, exact: true }).boundingBox();
  const toggle = await detailsToggle(page).boundingBox();
  expect(toggle!.x).toBeGreaterThanOrEqual(heading!.x + heading!.width);
  await expect(page.locator(".list-actions").getByRole("button", { name: "搜索在线资料", exact: true })).toBeVisible();
  async function beforeSorting() {
    const action = await scraping(page).boundingBox();
    const sort = await page.getByRole("combobox", { name: "曲目排序", exact: true }).boundingBox();
    expect(action!.x + action!.width).toBeLessThanOrEqual(sort!.x);
    expect(Math.abs(action!.y + action!.height / 2 - sort!.y - sort!.height / 2)).toBeLessThan(2);
  }
  await beforeSorting();
  await page.screenshot({ path: info.outputPath("album-desktop-dark-collapsed.png") });
  await detailsToggle(page).click();
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
  const panel = details(page);
  expect(await detailsToggle(page).getAttribute("aria-controls")).toBe(await panel.getAttribute("id"));
  for (const label of ["显示名", "原名", "平台专辑名", "艺人", "发行日期", "发行商", "音乐风格", "补充信息"]) {
    await expect(panel.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(panel.getByText(candidate.artist, { exact: true })).toBeVisible();
  await expect(panel.getByText("2013/4/2", { exact: true })).toBeVisible();
  await expect(panel.getByText(candidate.description, { exact: true })).toBeVisible();
  await expect(panel.getByText("华语流行", { exact: true })).toBeVisible();
  await expect(panel).not.toContainText("Mandopop");
  await expect(panel).not.toContainText(candidate.date);
  await expect(panel).not.toContainText("album-source");
  await expect(panel).not.toContainText("专辑资料源");
  await expect(panel.getByRole("link", { name: "在平台查看", exact: true })).toHaveAttribute("href", candidate.sourceUrl);
  await page.screenshot({ path: info.outputPath("album-desktop-dark-expanded.png") });
  await detailsToggle(page).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("checkbox", { name: "选择 第一曲", exact: true }).check();
  await expect(page.getByRole("button", { name: "添加到歌单", exact: true })).toBeVisible();
  await beforeSorting();
  await scraping(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "清空选择", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(scraping(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("album-mobile-light-collapsed.png") });
  await detailsToggle(page).click();
  await expect(panel.getByText("2013/4/2", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("album-mobile-light-expanded.png") });
});

test("an empty album still exposes scraping and details without an oversized metadata section", async ({ page }) => {
  await mock(page, { empty: true });
  await openAlbum(page, false);
  await expect(page.locator(".tracks tbody tr")).toHaveCount(0);
  await expect(details(page)).toHaveCount(0);
  await expect(scraping(page)).toBeEnabled();
  await scraping(page).click();
  await expect(dialog(page)).toBeVisible();
});

test("saved metadata without a platform URL does not invent a source link or display plugin identifiers", async ({ page }) => {
  const state = await mock(page);
  const { sourceUrl: _sourceUrl, ...item } = candidate;
  state.saved = [{ field: "albumDetails", pluginId: "legacy-private-plugin", item }];
  await openAlbum(page, false);
  await detailsToggle(page).click();
  await expect(details(page).getByText(candidate.description, { exact: true })).toBeVisible();
  await expect(details(page).getByRole("link", { name: "在平台查看", exact: true })).toHaveCount(0);
  await expect(details(page)).not.toContainText("legacy-private-plugin");
});

for (const field of ["albumTracks", "artwork"]) {
  test(`an older ${field}-only selection still shows the basic album information once`, async ({ page }) => {
    const state = await mock(page);
    await page.route("https://example.org/cover.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: artwork }));
    state.saved = [{ field, pluginId: "previous-source", item: { ...completeCandidate, imageUrl: "https://example.org/cover.svg" } }];
    await openAlbum(page, false);
    await detailsToggle(page).click();
    const panel = details(page);
    await expect(panel.getByRole("heading", { name: "专辑资料", exact: true })).toHaveCount(1);
    await expect(panel.getByText("显示名", { exact: true })).toHaveCount(1);
    await expect(panel.getByText("原名", { exact: true })).toHaveCount(1);
    await expect(panel.getByText(album.name, { exact: true })).toBeVisible();
    await expect(panel.getByText(album.originalName, { exact: true })).toBeVisible();
  });
}

for (const [genre, label] of [["Cantopop", "粤语流行"], ["Experimental", "Experimental"]]) {
  test(`saved music style ${genre} uses its readable label without losing an unknown style`, async ({ page }) => {
    const state = await mock(page);
    state.saved = [{ field: "albumDetails", pluginId: "album-source", item: { ...candidate, genre } }];
    await openAlbum(page, false);
    await detailsToggle(page).click();
    await expect(details(page).getByText("音乐风格", { exact: true })).toBeVisible();
    await expect(details(page).getByText(label, { exact: true })).toBeVisible();
  });
}

test("album cards and their heading use the returned cover without per-card metadata requests", async ({ page }, info) => {
  const state = await mock(page);
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}`);
  const card = page.getByRole("button", { name: "夜间专辑 2 首", exact: true });
  const image = card.locator("img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", state.album.coverPath!);
  expect(state.reads.filter((path) => path === "/library/albums")).toHaveLength(1);
  expect(state.reads.some((path) => path.startsWith("/library/albums/"))).toBe(false);
  await page.screenshot({ path: info.outputPath("album-card-cover.png") });
  await card.click();
  const headingCover = page.getByRole("img", { name: `${album.name} 的专辑封面`, exact: true });
  await expect(headingCover).toBeVisible();
  await expect(headingCover).toHaveAttribute("src", state.album.coverPath!);
  await expect(details(page)).toHaveCount(0);
});

for (const brokenCover of [false, true]) {
  test(`an album with ${brokenCover ? "damaged" : "missing"} artwork retains a cover placeholder`, async ({ page }) => {
    await mock(page, { coverPath: brokenCover ? "/api/v1/media/album-artwork" : null, brokenCover });
    await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}`);
    const card = page.getByRole("button", { name: "夜间专辑 2 首", exact: true });
    await expect(card).toBeVisible();
    await expect(card.locator(".album-cover svg")).toBeVisible();
    await expect(card.locator("img")).toHaveCount(0);
    await card.click();
    await expect(page.getByRole("img", { name: `${album.name} 的专辑封面`, exact: true })).toHaveCount(0);
    await expect(page.locator(".category-heading .album-cover svg")).toBeVisible();
    await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "false");
  });
}
