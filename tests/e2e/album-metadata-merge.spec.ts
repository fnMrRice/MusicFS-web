import { expect, test, type Locator, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { album, candidate, artwork, mock, details, detailsToggle, openAlbum as openAlbumFixture } from "./album-scraping-mock";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const comparison = (page: Page) => page.getByRole("dialog", { name: "对比专辑资料", exact: true });
const editor = (page: Page) => page.getByRole("dialog", { name: "编辑专辑资料", exact: true });
async function openDetails(page: Page) {
  await openAlbumFixture(page, origin, false);
  await detailsToggle(page).click();
}
async function linkedAlbum(page: Page) {
  const state = await mock(page);
  state.album.sourceLinks = [{ url: candidate.sourceUrl, pluginId: "album-source" }];
  state.album.releaseDate = "2013-04-02";
  state.saved = [{ field: "albumDetails", pluginId: "album-source", item: {
    ...candidate, publisher: undefined, description: "原来的补充信息" } }];
  state.online = { ...candidate, title: "平台更新专辑", album: "平台更新专辑", artist: "平台新歌手",
    date: "2025-02-03", publisher: "平台新发行商", genre: "Cantopop", description: "平台新的介绍",
    imageUrl: "https://example.org/new-cover.svg" };
  await page.route("https://example.org/new-cover.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: artwork }));
  return state;
}
async function refresh(page: Page) {
  await details(page).getByRole("button", { name: "刷新资料", exact: true }).click();
  const panel = comparison(page);
  await panel.getByRole("button", { name: "读取平台资料", exact: true }).click();
  await expect(panel.getByRole("checkbox", { name: "显示名", exact: true })).toBeVisible();
  return panel;
}
async function selectOnly(panel: Locator, label: string) {
  for (const checkbox of await panel.getByRole("checkbox").all()) {
    if (await checkbox.isEnabled()) await checkbox.uncheck();
  }
  await panel.getByRole("checkbox", { name: label, exact: true }).check();
}

test("saving an associated platform page only updates the album and leaves scraping for an explicit refresh", async ({ page }) => {
  const state = await mock(page);
  await openDetails(page);
  await expect(details(page).getByRole("button", { name: "刷新资料", exact: true })).toBeDisabled();
  await details(page).getByRole("button", { name: "编辑资料", exact: true }).click();
  await editor(page).getByRole("button", { name: "添加平台链接", exact: true }).click();
  await editor(page).getByRole("combobox", { name: "资料平台", exact: true }).selectOption("album-source");
  await editor(page).getByLabel("平台专辑页面", { exact: true }).fill(candidate.sourceUrl);
  await editor(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(details(page).getByRole("button", { name: "刷新资料", exact: true })).toBeEnabled();
  expect(state.searches).toEqual([]);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ path: "/library/albums/one", body: {
    expectedRevision: 1, sourceLinks: [{ url: candidate.sourceUrl, pluginId: "album-source" }] } });
  await details(page).getByRole("button", { name: "编辑资料", exact: true }).click();
  await expect(editor(page).getByLabel("平台专辑页面", { exact: true })).toHaveValue(candidate.sourceUrl);
  await editor(page).getByRole("button", { name: "移除链接", exact: true }).click();
  await editor(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(state.searches).toEqual([]);
  expect(state.album.sourceLinks).toEqual([]);
  await expect(details(page).getByRole("button", { name: "刷新资料", exact: true })).toBeDisabled();
});

test("refresh compares current and platform values without writing and cancel preserves all current information", async ({ page }, info) => {
  const state = await linkedAlbum(page);
  const before = structuredClone({ album: state.album, saved: state.saved });
  await page.emulateMedia({ colorScheme: "dark" });
  await openDetails(page);
  const panel = await refresh(page);
  await expect(panel.locator(".album-compare-heading").getByText("当前资料", { exact: true })).toBeVisible();
  await expect(panel.locator(".album-compare-heading").getByText("平台新资料", { exact: true })).toBeVisible();
  const names = panel.locator(".album-compare-row").filter({ hasText: "显示名" });
  await expect(names).toContainText("平台更新专辑");
  await expect(names).toContainText(album.name);
  await expect(panel.getByRole("checkbox", { name: "显示名", exact: true })).not.toBeChecked();
  await expect(panel.getByRole("checkbox", { name: "曲目表", exact: true })).not.toBeChecked();
  await expect(panel.getByRole("list", { name: "当前曲目表" }).getByText("第一曲", { exact: true })).toBeVisible();
  await expect(panel.getByRole("list", { name: "平台曲目表" }).getByText(/未收录曲目/)).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: "发行商", exact: true })).toBeChecked();
  expect(state.searches).toEqual([{ field: "albumDetails", query: { sourceUrl: candidate.sourceUrl } },
    { field: "albumTracks", query: { externalId: candidate.id, sourceUrl: candidate.sourceUrl } }]);
  expect(state.writes).toEqual([]);
  expect({ album: state.album, saved: state.saved }).toEqual(before);
  await page.screenshot({ path: info.outputPath("album-merge-desktop-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("album-merge-mobile-light.png") });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(state.writes).toEqual([]);
  expect({ album: state.album, saved: state.saved }).toEqual(before);
});

test("selecting only the display name preserves every other field and the existing track list", async ({ page }) => {
  const state = await linkedAlbum(page);
  const before = structuredClone({ album: state.album, saved: state.saved });
  await openDetails(page);
  const panel = await refresh(page);
  await selectOnly(panel, "显示名");
  await panel.getByRole("button", { name: "合并选中资料", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "平台更新专辑", exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ path: "/library/albums/one/metadata-merge", body: {
    expectedRevision: 1, pluginId: "album-source", fields: ["name"] } });
  expect(state.album).toEqual({ ...before.album, name: "平台更新专辑", revision: 2 });
  expect(state.saved).toEqual(before.saved);
  await expect(page.locator(".tracks tbody tr")).toHaveCount(2);
});

test("selecting only the track list adds the missing gray track while preserving album and text fields", async ({ page }) => {
  const state = await linkedAlbum(page);
  const before = structuredClone({ album: state.album, saved: state.saved });
  await openDetails(page);
  const panel = await refresh(page);
  await selectOnly(panel, "曲目表");
  await panel.getByRole("button", { name: "合并选中资料", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(state.writes[0].body.fields).toEqual(["tracks"]);
  expect(state.album).toEqual({ ...before.album, revision: 2 });
  expect(state.saved.find((field) => field.field === "albumDetails")).toEqual(before.saved[0]);
  const missing = page.locator(".tracks tbody tr").filter({ hasText: "未收录曲目" });
  await expect(missing).toHaveClass(/source-missing/);
  await expect(missing.getByRole("button", { name: "播放 未收录曲目", exact: true })).toBeDisabled();
});

test("a failed refresh or an empty selection cannot publish metadata", async ({ page }) => {
  const state = await linkedAlbum(page);
  const before = structuredClone({ album: state.album, saved: state.saved });
  state.trackSearchFailure = true;
  await openDetails(page);
  await details(page).getByRole("button", { name: "刷新资料", exact: true }).click();
  await comparison(page).getByRole("button", { name: "读取平台资料", exact: true }).click();
  await expect(comparison(page).getByRole("alert")).toBeVisible();
  expect(state.writes).toEqual([]);
  expect({ album: state.album, saved: state.saved }).toEqual(before);
  await page.keyboard.press("Escape");
  state.trackSearchFailure = false;
  const panel = await refresh(page);
  for (const checkbox of await panel.getByRole("checkbox").all()) if (await checkbox.isEnabled()) await checkbox.uncheck();
  await expect(panel.getByRole("button", { name: "合并选中资料", exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]);
});

test("a conflicting merge re-reads the revision and fresh candidates before another selection", async ({ page }) => {
  const state = await linkedAlbum(page);
  state.conflict = true;
  state.rotateTokens = true;
  await openDetails(page);
  const panel = await refresh(page);
  await selectOnly(panel, "显示名");
  await panel.getByRole("button", { name: "合并选中资料", exact: true }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(panel.getByRole("checkbox", { name: "显示名", exact: true })).toBeVisible();
  await selectOnly(panel, "显示名");
  await panel.getByRole("button", { name: "合并选中资料", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(state.writes.map((write) => write.body.expectedRevision)).toEqual([1, 2]);
  expect(state.writes.map((write) => write.body.candidates)).toEqual([
    { albumDetails: "details-token-1", albumTracks: "tracks-token-1" },
    { albumDetails: "details-token-2", albumTracks: "tracks-token-2" },
  ]);
  expect(state.searches).toHaveLength(4);
});

for (const mergeFailure of ["before", "after"] as const) {
  test(`an uncertain ${mergeFailure}-commit response replays the same field selection and idempotency key`, async ({ page }) => {
    const state = await linkedAlbum(page);
    state.mergeFailure = mergeFailure;
    await openDetails(page);
    const panel = await refresh(page);
    await selectOnly(panel, "显示名");
    await panel.getByRole("button", { name: "合并选中资料", exact: true }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByRole("checkbox", { name: "显示名", exact: true })).toBeDisabled();
    if (mergeFailure === "before") expect(state.album.name).toBe(album.name);
    await panel.getByRole("button", { name: "重试确认保存", exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(state.writes).toHaveLength(2);
    expect(state.writes[0].body).toEqual(state.writes[1].body);
    expect(state.writes[0].key).toBeTruthy();
    expect(state.writes[0].key).toBe(state.writes[1].key);
    expect(state.album.revision).toBe(2);
  });
}
