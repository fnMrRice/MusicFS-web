import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import type { MusicTrack, TrackMetadata } from "../../src/api/music-catalog";
import { routeApi } from "../fixtures/control-mock";
import { track } from "../fixtures/dto";
import { musicPage, musicTrack } from "../fixtures/music-catalog";
import { album } from "./album-scraping-mock";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

function albumTrack(id: string, title: string, revision: number): MusicTrack {
  return { ...musicTrack({ ...track, sourceTrackId: id, title, displayName: `${title}.flac`, assetId: `asset-${id}` }),
    trackId: id, revision, artists: [{ artistId: "solo", name: "米津玄師" }],
    albums: [{ albumId: album.albumId, name: album.name }] };
}

async function catalog(page: Page, { grey = false, otherAlbum = false } = {}) {
  const first = albumTrack("first", "打上花火", 7), second = albumTrack("second", "Uchiagehanabi", 11);
  if (grey) second.selectedSource = null;
  if (otherAlbum) second.albums = [{ albumId: "two", name: "另一张专辑" }];
  const artist = { artistId: "solo", name: "米津玄師", namesRevision: 3, localizedNames: [{ language: "ja", title: "米津玄師" }] };
  const state = { items: [first, second], trackReads: 0, artistReads: 0, albumRevision: 4, matchingRevision: 8,
    writes: [] as { path: string; method: string; body: unknown; key?: string }[] };
  await routeApi(page, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1", "");
    if (request.method() !== "GET") state.writes.push({ path, method: request.method(), body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
    if (path === "/health/ready") return route.fulfill({ json: { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "catalog" } });
    if (path === "/auth/session") return route.fulfill({ json: { csrfToken: "csrf", user: { id: "listener", role: "user" } } });
    if (path === "/me/profile") return route.fulfill({ json: { user: { id: "listener", role: "user" }, nickname: "听众" } });
    if (path === "/me/favorites") return route.fulfill({ json: { items: [], nextCursor: null, revision: "1" } });
    if (path === "/provider-instances") return route.fulfill({ json: { items: [{ id: track.providerInstanceId,
      name: "本地音乐", capabilities: [], availability: "available", roots: [] }] } });
    if (path === "/library/tracks") {
      state.trackReads++;
      const filter = url.searchParams.get("albumId");
      return route.fulfill({ json: { ...musicPage([], String(state.albumRevision), state.matchingRevision),
        items: state.items.filter(item => !filter || item.albums.some(entry => entry.albumId === filter)) } });
    }
    if (path === "/library/albums/one") return route.fulfill({ json: { ...album, revision: state.albumRevision } });
    if (path === "/library/albums/one/merge-tracks") {
      const body = request.postDataJSON();
      const primary = state.items.find(item => item.trackId === body.targetTrackId)!;
      const metadata: TrackMetadata | undefined = body.metadata;
      const sources = state.items.flatMap(item => item.selectedSource?.versions ?? []);
      const merged = { ...primary, revision: primary.revision! + 1, trackId: sources.length > 1 ? "recording-merged" : primary.trackId,
        localizedTitles: state.items.filter(item => item !== primary).map(item => ({ language: "und", title: item.title })),
        ...(metadata && { ...metadata, artists: metadata.artistNames.map(name => ({ artistId: name, name })) }),
        selectedSource: primary.selectedSource && { ...primary.selectedSource, versions: sources } };
      state.items = [merged]; state.albumRevision++; state.matchingRevision++;
      return route.fulfill({ json: merged });
    }
    if (path === "/library/artists/solo") {
      state.artistReads++;
      return route.fulfill({ json: artist });
    }
    if (path === "/library/artists/solo/names") {
      artist.localizedNames = request.postDataJSON().localizedNames;
      artist.namesRevision++;
      return route.fulfill({ json: artist });
    }
    return route.fulfill({ json: { items: [], nextCursor: null, nextAfter: null } });
  });
  return state;
}

const mergeButton = (page: Page) => page.getByRole("button", { name: "合并歌曲", exact: true });
const mergeDialog = (page: Page) => page.getByRole("dialog", { name: "合并歌曲", exact: true });
const choose = (page: Page, title: string) => page.getByRole("checkbox", { name: `选择 ${title}`, exact: true }).check();
const albumDetail = () => `${origin}/#/library?category=${encodeURIComponent("专辑")}&categoryId=one`;
const artistDetail = () => `${origin}/#/library?category=${encodeURIComponent("歌手")}&categoryId=solo`;

test("同专辑两首有来源的歌曲可以选择第二首为主曲，合并成新的录音后重新载入", async ({ page }) => {
  const state = await catalog(page);
  await page.goto(albumDetail());
  await choose(page, "打上花火"); await choose(page, "Uchiagehanabi");
  await expect(mergeButton(page)).toHaveCount(1);
  await mergeButton(page).click();
  const dialog = mergeDialog(page);
  await expect(dialog.getByRole("radio", { name: /打上花火/ })).toBeEnabled();
  await dialog.getByRole("radio", { name: /Uchiagehanabi/ }).check();
  const reads = state.trackReads;
  await dialog.getByRole("button", { name: "确认合并" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("checkbox", { name: "选择 打上花火", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "选择 Uchiagehanabi", exact: true })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "展开 Uchiagehanabi 的来源版本" })).toBeVisible();
  expect(state.trackReads).toBeGreaterThan(reads);
  await expect(page.getByRole("row", { name: /播放 Uchiagehanabi/ }).getByText("打上花火", { exact: true })).toBeVisible();
  expect(state.writes.filter(write => write.path.endsWith("/merge-tracks"))).toEqual([{
    path: "/library/albums/one/merge-tracks", method: "POST", key: expect.any(String),
    body: { targetTrackId: "second", expectedMatchingRevision: 8, expectedAlbumRevision: 4,
      metadata: { title: "Uchiagehanabi", localizedTitles: [{ language: "und", title: "打上花火" }],
        artistNames: ["米津玄師"], coverPath: null, genre: null, year: null, rating: null },
      tracks: expect.arrayContaining([{ trackId: "first", expectedRevision: 7 }, { trackId: "second", expectedRevision: 11 }]) },
  }]);
});

test("无来源曲目可在专辑内合并到有来源曲目", async ({ page }) => {
  const state = await catalog(page, { grey: true });
  await page.goto(albumDetail());
  await expect(page.getByRole("row", { name: /Uchiagehanabi/ })).toHaveClass(/source-missing/);
  await choose(page, "Uchiagehanabi"); await choose(page, "打上花火");
  await mergeButton(page).click();
  const dialog = mergeDialog(page);
  await expect(dialog.getByRole("radio", { name: /Uchiagehanabi/ })).toBeEnabled();
  await expect(dialog.getByRole("radio", { name: /打上花火/ })).toBeChecked();
  await dialog.getByRole("button", { name: "确认合并" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("checkbox", { name: "选择 Uchiagehanabi", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "选择 打上花火", exact: true })).not.toBeChecked();
  await expect(page.getByRole("row", { name: /播放 打上花火/ }).getByText("Uchiagehanabi", { exact: true })).toBeVisible();
  expect(state.writes.filter(write => write.path.endsWith("/merge-tracks")).map(write => write.body)).toEqual([
    expect.objectContaining({ targetTrackId: "first" }),
  ]);
});

test("合并逐字段取值并编辑，切换主曲保留显式选择，一次提交最终资料", async ({ page }) => {
  const state = await catalog(page, { grey: true });
  Object.assign(state.items[0], { genre: "J-pop", rating: 5 });
  Object.assign(state.items[1], { year: 2017, artists: [{ artistId: "daoko", name: "DAOKO" }],
    localizedTitles: [{ language: "en", title: "Fireworks" }] });
  await page.goto(albumDetail());
  await choose(page, "打上花火"); await choose(page, "Uchiagehanabi");
  await mergeButton(page).click();
  const dialog = mergeDialog(page);
  await expect(dialog.getByLabel("年份", { exact: true })).toHaveValue("2017");
  await expect(dialog.getByLabel("歌手", { exact: true })).toHaveValue("米津玄師\nDAOKO");
  const titleSource = dialog.getByRole("combobox", { name: "曲名取值来源", exact: true });
  await titleSource.selectOption("track:second");
  await expect(dialog.getByLabel("曲名", { exact: true })).toHaveValue("Uchiagehanabi");
  await dialog.getByLabel("音乐风格", { exact: true }).fill("流行");
  await dialog.getByLabel("评分", { exact: true }).selectOption("");
  await dialog.getByRole("radio", { name: /Uchiagehanabi/ }).check();
  await expect(dialog.getByLabel("音乐风格", { exact: true })).toHaveValue("流行");
  await dialog.getByLabel("歌手取值来源").selectOption("track:first");
  const title = dialog.getByLabel("曲名", { exact: true });
  await title.fill("");
  await expect(dialog.getByRole("button", { name: "确认合并" })).toBeDisabled();
  await title.fill("打ち上げ花火");
  expect(state.writes.filter(write => write.path.endsWith("/merge-tracks"))).toHaveLength(0);
  await dialog.getByRole("button", { name: "确认合并" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("checkbox", { name: "选择 打ち上げ花火" })).toBeVisible();
  expect(state.writes.filter(write => write.path.endsWith("/merge-tracks")).map(write => write.body)).toEqual([
    expect.objectContaining({ targetTrackId: "second", metadata: { title: "打ち上げ花火", artistNames: ["米津玄師"],
      genre: "流行", rating: null, year: 2017, coverPath: null, localizedTitles: expect.arrayContaining([
        { language: "en", title: "Fireworks" }, { language: "und", title: "Uchiagehanabi" }, { language: "und", title: "打上花火" },
      ]) } }),
  ]);
});

test("结果未知时锁定最终资料，并用相同请求重试合并", async ({ page }) => {
  const state = await catalog(page);
  let firstRequest: { body: unknown; key: string } | undefined;
  await page.route("**/albums/one/merge-tracks", async route => {
    if (firstRequest) return route.fallback();
    const req = route.request();
    firstRequest = { body: req.postDataJSON(), key: req.headers()["idempotency-key"] };
    return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Service unavailable" } } });
  });
  await page.goto(albumDetail());
  await choose(page, "打上花火"); await choose(page, "Uchiagehanabi");
  await mergeButton(page).click();
  const dialog = mergeDialog(page);
  await dialog.getByLabel("年份", { exact: true }).fill("2018");
  await dialog.getByRole("button", { name: "确认合并" }).click();
  await expect(dialog.getByLabel("年份", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("年份取值来源")).toBeDisabled();
  await dialog.getByRole("button", { name: "重试确认保存" }).click();
  await expect(dialog).toBeHidden();
  expect(state.writes.filter(write => write.path.endsWith("/merge-tracks")).map(({ body, key }) => ({ body, key }))).toEqual([firstRequest]);
});

test("歌手列表跨专辑勾选有来源与无来源曲目，无法启动专辑内合并", async ({ page }) => {
  const state = await catalog(page, { grey: true, otherAlbum: true });
  await page.goto(artistDetail());
  await choose(page, "Uchiagehanabi"); await choose(page, "打上花火");
  await expect(page.getByRole("row", { name: /Uchiagehanabi/ })).toContainText("另一张专辑");
  await expect(mergeButton(page)).toBeDisabled();
  await expect(mergeDialog(page)).toHaveCount(0);
  expect(state.writes.filter(write => write.path.endsWith("/merge-tracks"))).toHaveLength(0);
});

test("歌手详情添加罗马字别名，保存并重新打开后保留原名和新名称", async ({ page }) => {
  const state = await catalog(page);
  await page.goto(artistDetail());
  const open = page.getByRole("button", { name: "多语言歌手名", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "多语言歌手名" });
  await expect(dialog.getByLabel("歌手名称")).toHaveValue("米津玄師");
  await dialog.getByRole("button", { name: "添加名称" }).click();
  await dialog.getByLabel("语言标签").nth(1).fill("ja-Latn");
  await dialog.getByLabel("歌手名称").nth(1).fill("Kenshi Yonezu");
  const reads = state.artistReads;
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => state.artistReads).toBeGreaterThan(reads);
  expect(state.writes.filter(write => write.path.endsWith("/names"))).toEqual([{
    path: "/library/artists/solo/names", method: "PUT", key: expect.any(String),
    body: { expectedRevision: 3, localizedNames: [{ language: "ja", title: "米津玄師" }, { language: "ja-Latn", title: "Kenshi Yonezu" }] },
  }]);
  await open.click();
  await expect(dialog.getByLabel("歌手名称").first()).toHaveValue("米津玄師");
  await expect(dialog.getByLabel("歌手名称").nth(1)).toHaveValue("Kenshi Yonezu");
});
