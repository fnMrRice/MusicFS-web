import { expect, test } from "@playwright/test";
import type { MusicTrack } from "../../src/api/music-catalog";
import { duplicateFixture } from "./duplicates-fixture";
import type { DirectoryTestServer } from "./directory-server";

let server: DirectoryTestServer | undefined;
test.afterEach(async () => { await server?.stop(); server = undefined; });

test("在真实曲库中编辑单曲，按字段合并并保留原音源", async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await duplicateFixture(page);
  server = fixture.server;
  const base = `${server.origin}/api/v1`;
  const { csrfToken } = await (await page.request.get(`${base}/auth/session`)).json();
  const headers = () => ({ Origin: fixture.server.origin, "X-CSRF-Token": csrfToken, "Idempotency-Key": crypto.randomUUID() });
  const album = await page.request.post(`${base}/library/albums`, { headers: headers(), data: { name: "测试专辑" } });
  expect(album.status(), await album.text()).toBe(201);
  const { albumId } = await album.json();
  const sourceId = fixture.tracks.find(track => track.displayName === "selected.wav")!.sourceTrackId;
  const sourced: MusicTrack = await (await page.request.get(`${base}/library/sources/${sourceId}/track`)).json();
  const sourceSetup = await page.request.put(`${base}/library/tracks/${sourced.trackId}`, { headers: headers(), data: {
    expectedRevision: sourced.revision, title: "原曲名", artistNames: ["歌手甲"], albumIds: [albumId],
  } });
  expect(sourceSetup.status(), await sourceSetup.text()).toBe(200);
  const donor = await page.request.post(`${base}/library/tracks`, { headers: headers(), data: {
    title: "平台曲名", localizedTitles: [{ language: "en", title: "Platform Title" }],
    artistNames: ["歌手乙"], albumIds: [albumId], year: 2020, rating: 5,
  } });
  expect(donor.status(), await donor.text()).toBe(201);
  const { trackId: donorId } = await donor.json();

  await page.goto(`${server.origin}/#/library?${new URLSearchParams({ category: "专辑", categoryId: albumId })}`);
  async function edit(title: string) {
    await page.getByRole("button", { name: `${title} 的更多操作`, exact: true }).click();
    await page.getByRole("menuitem", { name: "编辑曲目元数据", exact: true }).click();
    return page.getByRole("dialog", { name: "编辑曲目元数据", exact: true });
  }
  const editor = await edit("原曲名");
  await editor.getByLabel("曲名", { exact: true }).fill("编辑后的曲名");
  await editor.getByLabel("音乐风格", { exact: true }).fill("民谣");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await page.getByRole("checkbox", { name: "选择 编辑后的曲名", exact: true }).check();
  await page.getByRole("checkbox", { name: "选择 平台曲名", exact: true }).check();
  await page.getByRole("button", { name: "合并歌曲", exact: true }).click();
  const merge = page.getByRole("dialog", { name: "合并歌曲", exact: true });
  await expect(merge.getByLabel("音乐风格", { exact: true })).toHaveValue("民谣");
  await expect(merge.getByLabel("年份", { exact: true })).toHaveValue("2020");
  await merge.getByLabel("曲名取值来源", { exact: true }).selectOption(`track:${donorId}`);
  await merge.getByLabel("歌手取值来源", { exact: true }).selectOption(`track:${donorId}`);
  await merge.getByLabel("年份", { exact: true }).fill("2021");
  await merge.getByLabel("评分", { exact: true }).selectOption("");
  await merge.getByRole("button", { name: "确认合并" }).click();
  await expect(merge).toBeHidden();

  await page.reload();
  await expect(page.locator("table.tracks tbody tr")).toHaveCount(1);
  const final = await edit("平台曲名");
  await expect(final.getByLabel("歌手", { exact: true })).toHaveValue("歌手乙");
  await expect(final.getByLabel("音乐风格", { exact: true })).toHaveValue("民谣");
  await expect(final.getByLabel("年份", { exact: true })).toHaveValue("2021");
  await expect(final.getByLabel("评分", { exact: true })).toHaveValue("");
  const saved: MusicTrack = await (await page.request.get(`${base}/library/sources/${sourceId}/track`)).json();
  expect(saved).toMatchObject({ trackId: sourced.trackId, title: "平台曲名", selectedSource: { sourceTrackId: sourceId },
    albums: [{ albumId }], artists: [{ name: "歌手乙" }], localizedTitles: expect.arrayContaining([
      { language: "en", title: "Platform Title" }, { language: "und", title: "编辑后的曲名" },
    ]) });
});
