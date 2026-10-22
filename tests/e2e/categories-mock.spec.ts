import { test, expect, type Page, type Route } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import type { Category, CategoryKind } from "../../src/api/categories";
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
  displayName: `${name}.flac`, title: name, artists: ["Artist A"], album: "Album A", genre: "Jazz", coverObjectId: name === "Alpha" ? "cover" : "broken",
  durationMs: 120000, codec: "flac", container: "flac", bitrateBps: null, availability: "available", assetId: name }));
const makeCategory = (kind: CategoryKind, id: string, name: string, unknown = false): Category => ({ categoryId: id, kind, name, unknown,
  providerInstanceId: kind === "genre" ? "" : "local", rootId: kind === "folder" ? "root" : "", parentId: null, trackCount: 2,
  breadcrumbs: [{ categoryId: id, name }] });
const root = makeCategory("folder", "folder-root", "Root");
const child: Category = { ...makeCategory("folder", "folder-child", "钢琴 & Live"), parentId: root.categoryId,
  breadcrumbs: [...root.breadcrumbs, { categoryId: "folder-child", name: "钢琴 & Live" }] };
const categories: Record<CategoryKind, Category[]> = {
  artist: [makeCategory("artist", "artist-known", "Artist A"), makeCategory("artist", "artist-unknown", "Unknown artist", true)],
  album: [makeCategory("album", "album-known", "Album A"), makeCategory("album", "album-unknown", "Unknown album", true)],
  genre: [makeCategory("genre", "genre-known", "Jazz"), makeCategory("genre", "genre-unknown", "Unknown genre", true)],
  folder: [root, child],
};
function catalogPage(url: URL, items: unknown[], overrides = {}) {
  const query = Object.fromEntries(url.searchParams); delete query.cursor; delete query.limit;
  query.type = url.pathname.endsWith("/categories") ? "categories" : "tracks";
  return { queryId: `query-${query.type}-${query.categoryKind}-${query.categoryId || query.parentId || "root"}-${query.q || ""}`,
    query, catalogRevision: "revision-1", expiresAt: "2030-10-22T12:00:00Z", total: items.length, items, nextCursor: null, ...overrides };
}
async function mockApi(page: Page, special?: (route: Route, url: URL) => Promise<boolean>) {
  const requests: URL[] = [];
  const released: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url()); const path = url.pathname; requests.push(url);
    if (special && await special(route, url)) return;
    if (route.request().method() === "DELETE" && path.includes("/library/queries/")) {
      released.push(decodeURIComponent(path.split("/").at(-1)!)); await route.fulfill({ status: 204 }); return;
    }
    if (path.endsWith("/media/cover")) {
      await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=", "base64") }); return;
    }
    if (path.endsWith("/media/broken")) { await route.fulfill({ status: 404 }); return; }
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "categories-mock" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "user", role: "admin" } };
    if (path.endsWith("/provider-instances")) json = { items: [
      { id: "local", name: "本地来源", capabilities: [], availability: "available", roots: [{ id: "root", name: "音乐收藏" }] },
      { id: "other", name: "另一来源", capabilities: [], availability: "available", roots: [] },
    ] };
    if (path.endsWith("/source-tracks")) json = { items: tracks.map((track) => ({ ...track, versions: [track] })), libraryRevision: "1", matchingRevision: 0, nextCursor: null };
    if (path.endsWith("/library/categories")) {
      const kind = url.searchParams.get("categoryKind") as CategoryKind;
      const selected = url.searchParams.get("categoryId"); const parent = url.searchParams.get("parentId");
      const items = categories[kind].filter((item) => selected ? item.categoryId === selected : kind === "folder" ? item.parentId === parent : true)
        .filter((item) => !url.searchParams.get("q") || item.name.includes(url.searchParams.get("q")!));
      json = catalogPage(url, url.searchParams.get("providerInstanceId") === "other" ? [] : items);
    }
    if (path.endsWith("/library/search")) json = catalogPage(url, tracks.filter((track) => !url.searchParams.get("q") || track.title?.includes(url.searchParams.get("q")!)));
    await route.fulfill({ json });
  });
  return { requests, released };
}
const tab = (page: Page, name: string) => page.getByLabel("曲目分类", { exact: true }).getByRole("button", { name, exact: true });

test("artists, albums and genres open scoped track lists, including unknown categories", async ({ page }) => {
  const { requests, released } = await mockApi(page);
  await page.goto(`${origin}/#/library`);
  for (const [label, name, unknown] of [["歌手", "Artist A", "未知歌手"], ["专辑", "Album A", "未知专辑"], ["流派", "Jazz", "未知流派"]]) {
    await tab(page, label).click();
    await expect(page.locator(".category-card").filter({ hasText: unknown })).toBeVisible();
    await page.locator(".category-card").filter({ hasText: name }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "选择 Alpha", exact: true })).toBeVisible();
    await expect(page.locator(".tracks tbody tr").first()).toContainText("Album A");
    await page.getByLabel("分类路径").getByRole("button", { name: label, exact: true }).click();
    await page.locator(".category-card").filter({ hasText: unknown }).click();
    await expect(page.getByRole("heading", { name: unknown, exact: true })).toBeVisible();
  }
  expect(requests.filter((url) => url.pathname.endsWith("/library/search")).every((url) => !!url.searchParams.get("categoryId"))).toBe(true);
  expect(released.length).toBeGreaterThan(6);
  expect(requests.some((url) => url.pathname.endsWith("/source-albums"))).toBe(false);
});

test("folder navigation restores breadcrumbs after reload and scopes search to the current subtree", async ({ page }) => {
  const { requests } = await mockApi(page);
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("文件夹")}`);
  await page.locator(".category-card").filter({ hasText: "音乐收藏" }).click();
  await expect(page.getByRole("heading", { name: "音乐收藏", exact: true })).toBeVisible();
  await page.locator(".category-card").filter({ hasText: "钢琴 & Live" }).click();
  await page.reload();
  await expect(page.getByLabel("分类路径")).toContainText("音乐收藏");
  await expect(page.getByRole("heading", { name: "钢琴 & Live", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "选择 Alpha", exact: true }).check();
  await page.getByRole("textbox", { name: "搜索当前列表", exact: true }).fill("Beta");
  await page.getByRole("textbox", { name: "搜索当前列表", exact: true }).press("Enter");
  await expect(page.getByRole("checkbox", { name: "选择 Alpha", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "选择 Beta", exact: true })).not.toBeChecked();
  expect(requests.some((url) => url.searchParams.get("categoryId") === child.categoryId && url.searchParams.get("q") === "Beta")).toBe(true);
  await page.getByLabel("分类路径").getByRole("button", { name: "音乐收藏", exact: true }).click();
  await expect(page.getByRole("heading", { name: "音乐收藏", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "来源", exact: true }).selectOption("other");
  await expect(page.getByRole("heading", { name: "暂无可浏览的分类", exact: true })).toBeVisible();
  expect(page.url()).not.toContain("categoryId");
});

test("track images use the returned media identity and damaged images fall back without per-track metadata requests", async ({ page }) => {
  let preparing: Route | null = null;
  const { requests } = await mockApi(page, async (route, url) => {
    if (url.pathname.endsWith("/playback/sessions") && route.request().method() === "POST") { preparing = route; return true; }
    return false;
  });
  await page.goto(`${origin}/#/library`);
  const rows = page.locator(".tracks tbody tr");
  await expect(rows.first().locator(".cover img")).toBeVisible();
  await expect.poll(() => rows.first().locator(".cover img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(rows.nth(1).locator(".cover svg")).toBeVisible();
  await page.getByRole("button", { name: "播放 Alpha.flac", exact: true }).click();
  await expect(page.getByRole("region", { name: "播放器", exact: true }).locator(".cover img")).toBeVisible();
  await expect.poll(() => preparing !== null).toBe(true);
  await (preparing as unknown as Route).abort();
  expect(requests.filter((url) => url.pathname.endsWith("/media-selection"))).toHaveLength(0);
  expect(requests.filter((url) => url.pathname.endsWith("/details"))).toHaveLength(0);
});

test("switching categories cancels pending reads and never shows their late results", async ({ page }) => {
  let pending: Route | null = null;
  await mockApi(page, async (route, url) => {
    if (url.pathname.endsWith("/library/categories") && url.searchParams.get("categoryKind") === "artist") { pending = route; return true; }
    return false;
  });
  await page.goto(`${origin}/#/library`); await tab(page, "歌手").click();
  await expect.poll(() => pending !== null).toBe(true);
  await tab(page, "流派").click();
  await expect(page.locator(".category-card").filter({ hasText: "Jazz" })).toBeVisible();
  const delayed = pending as unknown as Route;
  await delayed.fulfill({ json: catalogPage(new URL(delayed.request().url()), categories.artist) }).catch(() => {});
  await expect(page.locator(".category-card").filter({ hasText: "Artist A" })).toHaveCount(0);
});
