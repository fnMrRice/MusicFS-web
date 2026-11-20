import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MusicTrack } from "../../src/api/music-catalog";
import type { DirectoryTestServer } from "./directory-server";
import { duplicateFixture } from "./duplicates-fixture";

let server: DirectoryTestServer | undefined;
test.afterEach(async () => { await server?.stop(); server = undefined; });

test("清空本张专辑的刮削资料后保留音源和平台链接，取消时保留全部资料", async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await duplicateFixture(page);
  server = fixture.server;
  const base = `${server.origin}/api/v1`;
  const { csrfToken } = await (await page.request.get(`${base}/auth/session`)).json();
  const headers = () => ({ Origin: fixture.server.origin, "X-CSRF-Token": csrfToken, "Idempotency-Key": crypto.randomUUID() });
  const link = { pluginId: "musicfs.scraper.bangumi", url: "https://bgm.tv/subject/2584" };
  const album = await page.request.post(`${base}/library/albums`, { headers: headers(), data: {
    name: "隔离测试专辑", publisher: "手动填写的发行商", sourceLinks: [link],
  } });
  expect(album.status(), await album.text()).toBe(201);
  const { albumId } = await album.json();
  const sourceId = fixture.tracks.find(track => track.displayName === "selected.wav")!.sourceTrackId;
  const sourceUrl = `${base}/library/sources/${sourceId}/track`;
  const sourced: MusicTrack = await (await page.request.get(sourceUrl)).json();
  const sourceSetup = await page.request.put(`${base}/library/tracks/${sourced.trackId}`, { headers: headers(), data: {
    expectedRevision: sourced.revision, title: "本地音轨", albumIds: [albumId],
  } });
  expect(sourceSetup.status(), await sourceSetup.text()).toBe(200);
  const track = await page.request.post(`${base}/library/tracks`, { headers: headers(), data: {
    title: "仅平台收录的音轨", albumIds: [albumId],
  } });
  expect(track.status(), await track.text()).toBe(201);
  const { trackId } = await track.json();
  // 在本次测试的临时数据库放入已选平台快照，避免依赖线上平台的曲目数据。
  const db = new DatabaseSync(join(server.directory, "data", "musicfs.sqlite"), { timeout: 5000 });
  try {
    db.exec("BEGIN IMMEDIATE");
    const save = db.prepare("INSERT INTO music_album_scraped_fields(album_id,field,document) VALUES(?,?,?)");
    const item = { id: "2584", title: "平台专辑", sourceUrl: link.url };
    const details = { field: "albumDetails", pluginId: link.pluginId, item: { ...item, genre: "测试音乐风格" } };
    const tracks = { field: "albumTracks", pluginId: link.pluginId, item: { ...item, tracks: [{ title: "仅平台收录的音轨", number: 1 }] } };
    for (const field of [details, tracks]) save.run(albumId, field.field, JSON.stringify(field));
    db.prepare("UPDATE music_tracks SET scraper_placeholder=1 WHERE id=?").run(trackId);
    db.prepare("INSERT INTO music_album_scraped_track_refs(album_id,slot,track_id,plugin_id,release_id,position) VALUES(?,?,?,?,?,?)")
      .run(albumId, "1:1", trackId, link.pluginId, item.id, 0);
    db.exec("COMMIT");
  } finally { db.close(); }

  const albumPath = `${base}/library/albums/${albumId}`;
  const fieldsPath = `${albumPath}/scraped-fields`;
  const getFields = async () => (await (await page.request.get(fieldsPath)).json()).items;
  const saved = await getFields();
  expect(saved).toHaveLength(2);
  const deletes: string[] = [];
  page.on("request", req => { if (req.method() === "DELETE") deletes.push(req.url()); });
  await page.goto(`${server.origin}/#/library?${new URLSearchParams({ category: "专辑", categoryId: albumId })}`);
  const details = page.getByRole("button", { name: "专辑详情", exact: true });
  await details.click();
  const clear = page.getByRole("button", { name: "清空刮削资料", exact: true });
  const modal = page.getByRole("dialog", { name: "清空刮削资料", exact: true });
  await clear.click();
  await expect(modal).toContainText("隔离测试专辑");
  await modal.getByRole("button", { name: "取消", exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByText("测试音乐风格", { exact: true })).toBeVisible();
  expect(await getFields()).toEqual(saved);
  expect(deletes).toEqual([]);

  await clear.click();
  await modal.getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(clear).toBeHidden();
  await expect(page.locator("table.tracks tbody tr")).toHaveCount(1);
  expect(deletes).toEqual([fieldsPath]);
  await page.reload();
  await details.click();
  await expect(page.getByText("尚无在线专辑资料，可通过「搜索」补充。")).toBeVisible();
  await expect(page.getByRole("link", { name: "bgm.tv" })).toHaveAttribute("href", link.url);
  await expect(page.getByText("手动填写的发行商", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "本地音轨 的更多操作" })).toBeVisible();
  expect(await getFields()).toEqual([]);
  expect((await page.request.get(`${base}/library/tracks/${trackId}`)).status()).toBe(404);
  const retained: MusicTrack = await (await page.request.get(sourceUrl)).json();
  expect(retained).toMatchObject({ trackId: sourced.trackId, albums: [{ albumId }], selectedSource: { sourceTrackId: sourceId } });
});
