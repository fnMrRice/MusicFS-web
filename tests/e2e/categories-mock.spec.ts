import { musicPage, musicTrack } from "../fixtures/music-catalog";
import { routeApi } from "../fixtures/control-mock";
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

const albumA = { albumId: "album-known", name: "Album A" };
const liveAlbum = { albumId: "live-edition", name: "Live Edition" };
const artistA = { artistId: "artist-known", name: "Artist A" };
const guestArtist = { artistId: "artist-guest", name: "Guest Artist" };
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
  artist: [makeCategory("artist", artistA.artistId, artistA.name), makeCategory("artist", guestArtist.artistId, guestArtist.name),
    makeCategory("artist", "artist-unknown", "Unknown artist", true)],
  album: [makeCategory("album", albumA.albumId, albumA.name), makeCategory("album", liveAlbum.albumId, liveAlbum.name),
    makeCategory("album", "album-unknown", "Unknown album", true)],
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
  await routeApi(page, async (route) => {
    const url = new URL(route.request().url()); const path = url.pathname; requests.push(url);
    if (special && await special(route, url)) return;
    if (route.request().method() === "DELETE" && path.includes("/library/queries/")) {
      released.push(decodeURIComponent(path.split("/").at(-1)!)); await route.fulfill({ status: 204 }); return;
    }
    if (path.endsWith("/media/cover")) {
      await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=", "base64") }); return;
    }
    if (path.endsWith("/media/broken")) { await route.fulfill({ status: 404 }); return; }
    if (path.includes("/library/albums/") && path.endsWith("/scraped-fields")) {
      await route.fulfill({ json: { items: [] } }); return;
    }
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "categories-mock" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "user", role: "admin" } };
    if (path.endsWith("/provider-instances")) json = { items: [
      { id: "local", name: "本地来源", capabilities: [], availability: "available", roots: [{ id: "root", name: "音乐收藏" }],
        plugin: { id: "local-plugin", name: "本地来源", localizedNames: {}, features: ["music-source"] } },
      { id: "other", name: "另一来源", capabilities: [], availability: "available", roots: [],
        plugin: { id: "other-plugin", name: "另一来源", localizedNames: {}, features: ["music-source"] } },
    ] };
    if (path.endsWith("/library/tracks")) json = { ...musicPage([]),
      items: tracks.filter(track => track.title?.includes(url.searchParams.get("q") || ""))
        .map((track) => ({ ...musicTrack(track), artists: [artistA], albums: [albumA] })) };
    for (const kind of ["artist", "album", "genre"] as const) {
      const collection = `/library/${kind}s`;
      const idKey = `${kind}Id`;
      if (path.endsWith(collection)) {
        const items = categories[kind].map((item) => ({
          [idKey]: item.unknown ? "" : item.categoryId, name: item.unknown ? "" : item.name, trackCount: item.trackCount,
        }));
        json = { items: url.searchParams.get("providerInstanceId") === "other" ? [] : items, nextAfter: null };
      }
      if (path.includes(collection + "/")) {
        const item = categories[kind].find((c) => c.categoryId === path.split("/").at(-1));
        json = item && { [idKey]: item.categoryId, name: item.name, ...(kind === "artist" ? { namesRevision: 1 } : {}),
          ...(kind === "album" ? { originalName: item.name, revision: 1, externalId: null, isExternal: false,
            sourceLinks: [],
            coverPath: null, publisher: null, releaseDate: null } : {}) };
      }
    }
    if (path.endsWith("/library/categories")) {
      const kind = url.searchParams.get("categoryKind") as CategoryKind;
      const selected = url.searchParams.get("categoryId"); const parent = url.searchParams.get("parentId");
      const items = categories[kind].filter((item) => selected ? item.categoryId === selected : kind === "folder" ? item.parentId === parent : true)
        .filter((item) => !url.searchParams.get("q") || item.name.includes(url.searchParams.get("q")!));
      json = catalogPage(url, url.searchParams.get("providerInstanceId") === "other" ? [] : items);
    }
    if (path.endsWith("/library/search")) json = catalogPage(url, tracks
      .filter((track) => !url.searchParams.get("q") || track.title?.includes(url.searchParams.get("q")!))
      .map((track) => ({ ...track, catalogArtists: [artistA], albums: [albumA] })));
    await route.fulfill({ json });
  });
  return { requests, released };
}
const tab = (page: Page, name: string) => page.getByLabel("曲目分类", { exact: true }).getByRole("button", { name, exact: true });

test("album views retain the chosen layout and show release information and per-album actions", async ({ page }) => {
  const { requests } = await mockApi(page, async (route, url) => {
    if (!url.pathname.endsWith("/library/albums")) return false;
    await route.fulfill({ json: { items: [
      { ...albumA, trackCount: 2, publisher: "Fixture Records", releaseDate: "2024-06-17" },
      { ...liveAlbum, trackCount: 0, publisher: null, releaseDate: null },
      { albumId: "", name: "", trackCount: 1, publisher: null, releaseDate: null },
    ], nextAfter: null } });
    return true;
  });
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}`);
  const cards = page.getByRole("button", { name: "卡片视图", exact: true });
  const list = page.getByRole("button", { name: "列表视图", exact: true });
  const more = (name: string) => page.getByRole("button", { name: `${name} 的更多操作`, exact: true });
  const menu = page.getByRole("menu");
  await expect(cards).toHaveAttribute("aria-pressed", "true");
  await more(albumA.name).click();
  await expect(menu.getByRole("menuitem", { name: "查看曲目" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more(albumA.name)).toBeFocused();
  await list.click();
  const row = page.getByRole("row").filter({ has: more(albumA.name) });
  await expect(row).toContainText(albumA.name);
  await expect(row.getByRole("cell", { name: /^2(?:\s*首)?$/ })).toBeVisible();
  await expect(row).toContainText("Fixture Records");
  await expect(row).toContainText(/2024\D+0?6\D+17/);
  expect(requests.some(url => url.pathname.includes("/library/albums/"))).toBe(false);
  await page.reload();
  await expect(row).toBeVisible();
  await more(liveAlbum.name).click();
  await expect(menu.getByRole("menuitem", { name: "查看曲目" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "播放全部" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await more("未知专辑").click();
  await menu.getByRole("menuitem", { name: "查看曲目" }).click();
  await expect(page.getByRole("heading", { name: "未知专辑", exact: true })).toBeVisible();
  await expect.poll(() => requests.some(url => url.searchParams.get("unknown") === "album")).toBe(true);
  await page.goBack();
  await expect(list).toHaveAttribute("aria-pressed", "true");
  await expect(row).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row.getByText(/Fixture Records · 2024/)).toBeVisible();
  await expect(more(albumA.name)).toBeInViewport();
  await more(albumA.name).click();
  await expect(menu.getByRole("menuitem", { name: "添加到歌单" })).toBeInViewport();
  await page.keyboard.press("Escape");
  await cards.click();
  await expect(page.locator(".category-card").filter({ hasText: albumA.name })).toBeVisible();
});

test("album queue actions load every page in provider scope and skip unavailable recordings", async ({ page }) => {
  const after: (string | null)[] = [];
  const offline = { ...tracks[0], sourceTrackId: "offline", title: "Offline", availability: "offline" };
  await mockApi(page, async (route, url) => {
    if (!url.pathname.endsWith("/library/tracks") || url.searchParams.get("albumId") !== albumA.albumId) return false;
    expect(url.searchParams.get("providerInstanceId")).toBe("local");
    after.push(url.searchParams.get("after"));
    const result = url.searchParams.has("after") ? musicPage([offline, tracks[1]]) : musicPage([tracks[0]], "1", 0, "next");
    await route.fulfill({ json: result });
    return true;
  });
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}&source=local`);
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await page.getByRole("button", { name: `${albumA.name} 的更多操作`, exact: true }).click();
  expect(after).toEqual([]);
  await page.getByRole("menuitem", { name: "加入队列", exact: true }).click();
  await page.getByRole("button", { name: "播放队列", exact: true }).click();
  await expect(page.locator(".queue-list button")).toHaveText(["Alpha", "Beta"]);
  expect(after).toEqual([null, "next"]);
});

test("artists, albums and genres open scoped track lists, including unknown categories", async ({ page }) => {
  const { requests } = await mockApi(page);
  const source = page.getByRole("combobox", { name: "来源", exact: true });
  await page.goto(`${origin}/#/library`);
  for (const [label, name, unknown] of [["歌手", "Artist A", "未知歌手"], ["专辑", "Album A", "未知专辑"], ["流派", "Jazz", "未知流派"]]) {
    await tab(page, label).click();
    await expect(source).toBeVisible();
    await expect(page.locator(".category-card").filter({ hasText: unknown })).toBeVisible();
    await page.locator(".category-card").filter({ hasText: name }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(source).toHaveCount(label === "专辑" ? 0 : 1);
    await expect(page.getByRole("checkbox", { name: "选择 Alpha", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "来源", exact: true })).toHaveCount(0);
    const row = page.locator(".tracks tbody tr").first();
    await expect(row.getByRole("link", { name: albumA.name, exact: true })).toBeVisible();
    await expect(row.getByRole("link", { name: artistA.name, exact: true })).toBeVisible();
    await page.getByLabel("分类路径").getByRole("button", { name: label, exact: true }).click();
    await page.locator(".category-card").filter({ hasText: unknown }).click();
    await expect(page.getByRole("heading", { name: unknown, exact: true })).toBeVisible();
    await expect(source).toHaveCount(label === "专辑" ? 0 : 1);
  }
  const filters = requests.filter((url) => url.pathname.endsWith("/library/tracks")).map((url) => url.searchParams);
  for (const field of ["artistId", "albumId", "genre"]) expect(filters.some((query) => query.has(field))).toBe(true);
  for (const kind of ["artist", "album", "genre"]) expect(filters.some((query) => query.get("unknown") === kind)).toBe(true);
  expect(requests.some((url) => url.pathname.endsWith("/source-albums"))).toBe(false);
});

test("an unknown album with no search results can refresh and clear its track filter", async ({ page }) => {
  const { requests } = await mockApi(page);
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}&unknownCategory=1&source=local`);
  const toolbar = page.locator(".list-actions");
  const search = toolbar.getByRole("textbox", { name: "搜索当前列表" });
  await search.fill("Unmatched");
  await toolbar.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("heading", { name: "没有找到相关曲目" })).toBeVisible();
  const reads = () => requests.filter(url => url.pathname.endsWith("/library/tracks") &&
    url.searchParams.get("providerInstanceId") === "local" && url.searchParams.get("unknown") === "album" &&
    url.searchParams.get("q") === "Unmatched").length;
  const beforeRefresh = reads();
  expect(beforeRefresh).toBeGreaterThan(0);
  await toolbar.getByRole("button", { name: "刷新列表" }).click();
  await expect.poll(reads).toBeGreaterThan(beforeRefresh);
  await toolbar.getByRole("button", { name: "清空", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: "选择 Alpha", exact: true })).toBeVisible();
});

test("a folder track menu edits the linked catalog track", async ({ page }) => {
  const attempts: string[] = [];
  const canonical = { ...musicTrack(tracks[0]), trackId: "catalog-1", title: "Library title", revision: 2 };
  await mockApi(page, async (route, url) => {
    if (url.pathname.endsWith("/library/sources/Alpha/track")) await route.fulfill({ json: canonical });
    else if (url.pathname.endsWith("/library/tracks/catalog-1")) {
      expect(route.request().method()).toBe("PUT");
      const metadata = { title: "Edited title", localizedTitles: [{ language: "und", title: "Alias" }],
        artistNames: ["AC/DC", "Earth, Wind & Fire"], genre: "Rock", year: 1980, rating: 4, coverPath: "/covers/rock.jpg" };
      expect(route.request().postDataJSON()).toEqual({ expectedRevision: 2, ...metadata });
      attempts.push(route.request().headers()["idempotency-key"]);
      if (attempts.length === 1) await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } });
      else await route.fulfill({ json: { ...canonical, ...metadata,
        artists: metadata.artistNames.map(name => ({ artistId: name, name })), revision: 3 } });
    } else return false;
    return true;
  });
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("文件夹")}&categoryId=folder-child`);
  await page.getByRole("button", { name: "Alpha 的更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "编辑曲目元数据" }).click();
  const modal = page.getByRole("dialog");
  const title = modal.getByLabel("曲名", { exact: true });
  const save = modal.getByRole("button", { name: "保存", exact: true });
  await expect(title).toHaveValue("Library title");
  await expect(save).toBeDisabled();
  await title.fill("Edited title");
  await modal.getByLabel("歌手", { exact: true }).fill("AC/DC\nEarth, Wind & Fire");
  await modal.getByLabel("年份", { exact: true }).fill("10000");
  await expect(save).toBeDisabled();
  await modal.getByLabel("年份", { exact: true }).fill("1980");
  await modal.getByLabel("音乐风格", { exact: true }).fill("Rock");
  await modal.getByLabel("评分", { exact: true }).selectOption("4");
  await modal.getByLabel("封面路径", { exact: true }).fill("/covers/rock.jpg");
  await modal.getByRole("button", { name: "添加名称" }).click();
  await modal.getByLabel("别名", { exact: true }).fill("Alias");
  await save.click();
  await expect(title).toBeDisabled();
  await modal.getByRole("button", { name: "重试确认保存" }).click();
  await expect(modal).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toBeTruthy();
  expect(attempts[1]).toBe(attempts[0]);
});

test("all tracks links each artist and album by catalog ID and shows providers in the expanded versions", async ({ page }) => {
  const alternate = { ...tracks[0], sourceTrackId: "alternate", providerInstanceId: "other", displayName: "Alpha live.flac" };
  const song = { ...musicTrack({ ...tracks[0], versions: [tracks[0], alternate] }), artists: [artistA, guestArtist], albums: [albumA, liveAlbum] };
  const noCredits = musicTrack({ ...tracks[1], artists: [], album: null });
  const { requests } = await mockApi(page, async (route, url) => {
    if (!url.pathname.endsWith("/library/tracks")) return false;
    await route.fulfill({ json: { ...musicPage([]), items: [song, noCredits] } });
    return true;
  });
  await page.goto(`${origin}/#/library?source=local`);
  const row = page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "选择 Alpha", exact: true }) });
  await expect(row.getByRole("link", { name: albumA.name, exact: true })).toBeVisible();
  const soloRow = page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "选择 Beta", exact: true }) });
  await expect(soloRow.getByRole("link")).toHaveCount(0);
  const soloToggle = soloRow.getByRole("button", { name: /Beta 的来源版本$/ });
  const versions = page.getByLabel("来源版本", { exact: true });
  await expect(soloToggle).toHaveText("1 个来源版本");
  await expect(soloToggle).toHaveAttribute("aria-expanded", "false");
  await soloToggle.click();
  await expect(soloToggle).toHaveAttribute("aria-expanded", "true");
  await expect(versions.getByText("本地来源", { exact: true })).toBeVisible();
  await expect(versions.getByRole("button", { name: "播放来源版本 Beta.flac" })).toBeVisible();
  await soloToggle.click();
  await expect(soloToggle).toHaveAttribute("aria-expanded", "false");
  await expect(versions).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "来源", exact: true })).toHaveCount(0);
  await expect(row.getByText("本地来源", { exact: true })).toHaveCount(0);
  const groupToggle = row.getByRole("button", { name: "展开 Alpha 的来源版本" });
  await expect(groupToggle).toHaveText("2 个来源版本");
  await groupToggle.click();
  await expect(versions.getByText("本地来源", { exact: true })).toBeVisible();
  await expect(versions.getByText("另一来源", { exact: true })).toBeVisible();
  for (const credit of [artistA, guestArtist, albumA, liveAlbum]) {
    await row.getByRole("link", { name: credit.name, exact: true }).click();
    await expect(page.getByRole("heading", { name: credit.name, exact: true })).toBeVisible();
    const [field, id] = "artistId" in credit ? ["artistId", credit.artistId] : ["albumId", credit.albumId];
    await expect.poll(() => requests.some(url => url.pathname.endsWith("/library/tracks") &&
      url.searchParams.get(field) === id && url.searchParams.get("providerInstanceId") === "local")).toBe(true);
    await page.goBack();
    await expect(tab(page, "全部曲目")).toHaveAttribute("aria-pressed", "true");
  }
});

test("all tracks requests source records while artist and album views keep gray metadata-only rows", async ({ page }) => {
  const available = { ...musicTrack(tracks[0]), artists: [artistA], albums: [albumA] };
  const offline = musicTrack({ ...tracks[1], availability: "offline" });
  const missing = { ...available, trackId: "metadata-only", title: "尚无音源的曲目", selectedSource: null };
  const queries: URLSearchParams[] = [];
  await mockApi(page, async (route, url) => {
    if (!url.pathname.endsWith("/library/tracks")) return false;
    queries.push(url.searchParams);
    await route.fulfill({ json: { ...musicPage([]), items: url.searchParams.get("sourceOnly") === "true"
      ? [available, offline] : [available, offline, missing] } });
    return true;
  });
  await page.goto(`${origin}/#/library`);
  const missingRow = page.locator(".tracks tbody tr").filter({ hasText: missing.title });
  await expect(page.getByRole("button", { name: "播放 Alpha", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "播放 Beta", exact: true })).toBeDisabled();
  await expect(missingRow).toHaveCount(0);
  expect(queries[0].get("sourceOnly")).toBe("true");
  for (const [label, name] of [["歌手", "Artist A"], ["专辑", "Album A"]]) {
    await tab(page, label).click();
    await page.locator(".category-card").filter({ hasText: name }).click();
    await expect(missingRow).toHaveClass(/source-missing/);
    await expect(missingRow.getByRole("link", { name: albumA.name, exact: true })).toBeVisible();
    await expect(missingRow.getByRole("link", { name: artistA.name, exact: true })).toBeVisible();
    await expect(missingRow.getByRole("cell", { name: "暂无来源", exact: true })).toHaveCount(0);
    const play = missingRow.getByRole("button", { name: `播放 ${missing.title}`, exact: true });
    await expect(play).toBeDisabled();
    const gray = await missingRow.evaluate((element) => getComputedStyle(element).color);
    await expect(play).toHaveCSS("color", gray);
    expect(gray).not.toBe(await page.getByRole("button", { name: "播放 Alpha", exact: true })
      .evaluate((element) => getComputedStyle(element).color));
    await expect(missingRow.getByRole("checkbox")).toBeEnabled();
    await expect(missingRow.getByRole("button", { name: `将 ${missing.title} 添加到歌单`, exact: true })).toBeEnabled();
    expect(queries.at(-1)?.has("sourceOnly")).toBe(false);
  }
  await tab(page, "全部曲目").click();
  await expect(missingRow).toHaveCount(0);
  expect(queries.at(-1)?.get("sourceOnly")).toBe("true");
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
  await expect(page.getByRole("columnheader", { name: "来源", exact: true })).toHaveCount(0);
  for (const name of [albumA.name, artistA.name]) {
    await page.locator(".tracks tbody tr").first().getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "钢琴 & Live", exact: true })).toBeVisible();
  }
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
  await page.getByRole("button", { name: "播放 Alpha", exact: true }).click();
  await expect(page.getByRole("region", { name: "播放器", exact: true }).locator(".cover img")).toBeVisible();
  await expect.poll(() => preparing !== null).toBe(true);
  await (preparing as unknown as Route).abort();
  expect(requests.filter((url) => url.pathname.endsWith("/media-selection"))).toHaveLength(0);
  expect(requests.filter((url) => url.pathname.endsWith("/details"))).toHaveLength(0);
});

test("switching categories cancels pending reads and never shows their late results", async ({ page }) => {
  let pending: Route | null = null;
  await mockApi(page, async (route, url) => {
    if (url.pathname.endsWith("/library/artists")) { pending = route; return true; }
    return false;
  });
  await page.goto(`${origin}/#/library`); await tab(page, "歌手").click();
  await expect.poll(() => pending !== null).toBe(true);
  await tab(page, "流派").click();
  await expect(page.locator(".category-card").filter({ hasText: "Jazz" })).toBeVisible();
  const delayed = pending as unknown as Route;
  await delayed.fulfill({ json: { items: [{ artistId: "known", name: "Artist A", trackCount: 2 }], nextAfter: null } }).catch(() => {});
  await expect(page.locator(".category-card").filter({ hasText: "Artist A" })).toHaveCount(0);
});
