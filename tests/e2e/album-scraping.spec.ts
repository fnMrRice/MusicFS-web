import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { album, candidate, completeCandidate, artwork, mock, dialog, details, detailsToggle, albumSearchButton,
  openAlbum as openAlbumFixture } from "./album-scraping-mock";
let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

async function openAlbum(page: Page, search = true) { return openAlbumFixture(page, origin, search); }

test("album browsing previews the complete release and saves metadata and missing tracks together", async ({ page }, info) => {
  const state = await mock(page);
  await openAlbum(page);
  const modal = dialog(page);
  await expect(modal.getByLabel("专辑名称", { exact: true })).toHaveValue(album.originalName);
  await expect(modal.getByRole("combobox", { name: "刮削内容", exact: true })).toHaveCount(0);
  await expect(modal.getByRole("radio", { name: "专辑资料源", exact: true })).toBeChecked();
  await modal.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(modal.getByRole("button", { name: "选用这张专辑", exact: true })).toHaveCount(0);
  await modal.getByRole("button", { name: "预览完整专辑", exact: true }).click();
  const previewTracks = modal.getByRole("table", { name: "专辑曲目" });
  await expect(previewTracks.getByRole("cell", { name: "第一曲", exact: true })).toBeVisible();
  expect(state.saved).toEqual([]);
  await expect(previewTracks.getByRole("cell", { name: "未收录曲目", exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "选用这张专辑", exact: true }).click();
  await expect(modal).toHaveCount(0);
  const saved = details(page);
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
  const tracklistToggle = saved.getByRole("button", { name: "曲目表", exact: true });
  const savedTracks = saved.getByRole("table", { name: "专辑曲目" });
  await expect(tracklistToggle).toHaveAttribute("aria-expanded", "false");
  await expect(savedTracks).toBeHidden();
  expect(state.searches).toEqual([{ field: "albumDetails", query: { title: album.originalName } },
    { field: "albumTracks", query: { externalId: candidate.id, sourceUrl: candidate.sourceUrl } }]);
  expect(state.writes).toEqual([{ path: "/library/albums/one/scraped-fields",
    body: { expectedRevision: 1, pluginId: "album-source", candidates: { albumDetails: "details-token", albumTracks: "tracks-token" } },
    key: expect.any(String) }]);
  const added = page.locator(".tracks tbody tr").filter({ hasText: "未收录曲目" });
  await expect(added).toHaveClass(/source-missing/);
  await expect(added.getByRole("button", { name: "播放 未收录曲目", exact: true })).toBeDisabled();
  await tracklistToggle.click();
  await expect(tracklistToggle).toHaveAttribute("aria-expanded", "true");
  await expect(savedTracks.getByRole("cell", { name: "第一曲", exact: true })).toBeVisible();
  await expect(savedTracks.getByRole("cell", { name: "未收录曲目", exact: true })).toBeVisible();
  await tracklistToggle.click();
  await expect(tracklistToggle).toHaveAttribute("aria-expanded", "false");
  await expect(savedTracks).toBeHidden();
  await expect(added).toBeVisible();
  await expect(page.getByRole("button", { name: "播放 第一曲", exact: true })).toBeEnabled();
  await page.reload();
  await expect(saved).toHaveCount(0);
  await detailsToggle(page).click();
  await expect(tracklistToggle).toHaveAttribute("aria-expanded", "false");
  await expect(savedTracks).toBeHidden();
  await tracklistToggle.click();
  await expect(savedTracks.getByRole("cell", { name: "第一曲", exact: true })).toBeVisible();
  await expect(saved.getByRole("link", { name: "在平台查看", exact: true }).first()).toHaveAttribute("href", candidate.sourceUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("album-scraping-mobile.png") });
});

test("an invalid album selection identifies the failed operation and includes its request ID", async ({ page }) => {
  const state = await mock(page);
  let invalidMetadata = true;
  await page.route("**/api/v1/library/albums/one/scraped-fields", async route => {
    if (route.request().method() !== "PUT") return route.fallback();
    expect(route.request().postDataJSON()).toEqual({ expectedRevision: 1, pluginId: "album-source",
      candidates: { albumDetails: "details-token", albumTracks: "tracks-token" } });
    await route.fulfill({ status: 400, headers: { "X-Request-ID": "album-validation-14" },
      json: { error: { code: "INVALID_ARGUMENT",
        message: invalidMetadata ? "Invalid music library metadata" : "untrusted internal diagnostic" } } });
  });
  await openAlbum(page);
  const modal = dialog(page);
  await modal.getByRole("button", { name: "搜索", exact: true }).click();
  await modal.getByRole("button", { name: "预览完整专辑", exact: true }).click();
  await modal.getByRole("button", { name: "选用这张专辑", exact: true }).click();
  const alert = modal.getByRole("alert");
  await expect(alert).toContainText("平台返回的曲名或其他音乐资料格式不符合曲库要求");
  await expect(alert).toContainText("请求编号：album-validation-14");
  invalidMetadata = false;
  await modal.getByRole("button", { name: "返回搜索结果" }).click();
  await modal.getByRole("button", { name: "预览完整专辑" }).click();
  await modal.getByRole("button", { name: "选用这张专辑", exact: true }).click();
  await expect(alert).toContainText("这份专辑资料未通过保存校验");
  await expect(alert).toContainText("请求编号：album-validation-14");
  await expect(alert).not.toContainText("untrusted internal diagnostic");
  expect(state.saved).toEqual([]);
  await page.evaluate(() => {
    localStorage.setItem("musicfs:language", "en");
    window.dispatchEvent(new StorageEvent("storage", { key: "musicfs:language" }));
  });
  const englishModal = page.getByRole("dialog", { name: "Search online metadata" });
  await expect(englishModal.getByRole("alert")).toContainText("The album metadata failed validation.");
  await expect(englishModal.getByRole("alert")).toContainText("Request ID: album-validation-14");
  await englishModal.getByRole("button", { name: "Back to results" }).click();
  await expect(englishModal.getByRole("button", { name: "Preview complete album" })).toBeEnabled();
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
  await albumSearchButton(page).click();
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
  await dialog(page).getByRole("checkbox", { name: "曲目表", exact: true }).check();
  await dialog(page).getByRole("button", { name: "合并选中资料", exact: true }).click();
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
  await expect(albumSearchButton(page)).toHaveCount(0);
  await expect(detailsToggle(page)).toHaveCount(0);
});

test("album search opens from expanded details before refresh, including while tracks are selected", async ({ page }, info) => {
  const state = await mock(page);
  state.saved = [{ field: "albumDetails", pluginId: "album-source", item: candidate }];
  await page.emulateMedia({ colorScheme: "dark" });
  state.album.sourceLinks = [{ url: candidate.sourceUrl, pluginId: "album-source" }];
  await openAlbum(page, false);
  await expect(details(page)).toHaveCount(0);
  const heading = await page.getByRole("heading", { name: album.name, exact: true }).boundingBox();
  const toggle = await detailsToggle(page).boundingBox();
  expect(toggle!.x).toBeGreaterThanOrEqual(heading!.x + heading!.width);
  const toolbarSearch = page.locator(".list-actions").getByRole("button", { name: /^(搜索|刮削|搜索在线资料)$/ });
  await expect(toolbarSearch).toHaveCount(0);
  const search = albumSearchButton(page);
  await expect(search).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("album-desktop-dark-collapsed.png") });
  await detailsToggle(page).click();
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
  const panel = details(page);
  await expect(search).toHaveText("搜索");
  const searchBox = await search.boundingBox();
  const refreshBox = await panel.getByRole("button", { name: "刷新资料", exact: true }).boundingBox();
  expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(refreshBox!.x);
  expect(Math.abs(searchBox!.y + searchBox!.height / 2 - refreshBox!.y - refreshBox!.height / 2)).toBeLessThan(2);
  expect(await detailsToggle(page).getAttribute("aria-controls")).toBe(await panel.getAttribute("id"));
  await expect(panel.getByText("平台专辑名", { exact: true })).toHaveCount(0);
  for (const label of ["显示名", "原名", "艺人", "发行日期", "发行商", "音乐风格", "补充信息"]) {
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
  await expect(panel.getByRole("link", { name: "example.org", exact: true })).toHaveAttribute("href", candidate.sourceUrl);
  await page.screenshot({ path: info.outputPath("album-desktop-dark-expanded.png") });
  await detailsToggle(page).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("checkbox", { name: "选择 第一曲", exact: true }).check();
  await expect(page.getByRole("button", { name: "添加到歌单", exact: true })).toBeVisible();
  await expect(toolbarSearch).toHaveCount(0);
  await expect(search).toHaveCount(0);
  await detailsToggle(page).click();
  await search.click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "选择 第一曲", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "清空选择", exact: true }).click();
  await detailsToggle(page).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(search).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("album-mobile-light-collapsed.png") });
  await detailsToggle(page).click();
  await expect(search).toBeInViewport();
  await expect(panel.getByText("2013/4/2", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("album-mobile-light-expanded.png") });
});

test("an empty album offers search in details without requiring a saved platform link", async ({ page }) => {
  await mock(page, { empty: true });
  await openAlbum(page, false);
  await expect(page.locator(".tracks tbody tr")).toHaveCount(0);
  await expect(details(page)).toHaveCount(0);
  await expect(albumSearchButton(page)).toHaveCount(0);
  await detailsToggle(page).click();
  await expect(details(page).getByRole("button", { name: "刷新资料", exact: true })).toBeDisabled();
  await expect(albumSearchButton(page)).toBeEnabled();
  await albumSearchButton(page).click();
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
