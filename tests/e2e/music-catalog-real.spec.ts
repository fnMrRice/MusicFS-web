import { expect, test } from "@playwright/test";
import { startDirectoryServer, type DirectoryTestServer } from "./directory-server";
import { login, waitPlaying } from "./helpers";
import { duplicateFixture } from "./duplicates-fixture";
import { waitControlResponse } from "../fixtures/control-probe";
import type { MusicTrack } from "../../src/api/music-catalog";

let server: DirectoryTestServer | undefined;
test.afterEach(async () => { await server?.stop(); server = undefined; });

test("a track without sources persists in artist, favorites and playlist views", async ({ page }) => {
  test.setTimeout(180_000);
  server = await startDirectoryServer();
  await login(page, server);
  const title = "未收录的演示曲", artist = "测试歌手";
  await page.getByRole("button", { name: "新建曲目", exact: true }).click();
  const form = page.getByRole("dialog", { name: "新建曲目" });
  await form.getByLabel("曲名", { exact: true }).fill(title);
  await form.getByLabel("歌手（每行一个，可选）").fill(artist);
  const [created] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/library/tracks") && r.request().method() === "POST"),
    form.getByRole("button", { name: "保存", exact: true }).click(),
  ]);
  expect(created.status(), await created.text()).toBe(201);
  const { trackId } = await created.json();
  await expect(form).toHaveCount(0);
  const row = page.locator(".tracks tbody tr").filter({ hasText: title });
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "歌手", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(artist) }).click();
  await expect(row).toHaveClass(/source-missing/);
  await expect(row.getByRole("button", { name: `播放 ${title}`, exact: true })).toBeDisabled();
  await expect(row).toContainText("暂无来源");
  expect(await row.locator(".track-play").evaluate((element) => getComputedStyle(element).color))
    .toBe(await row.evaluate((element) => getComputedStyle(element).color));
  await expect(page.getByRole("button", { name: "播放全部", exact: true })).toBeDisabled();
  await row.getByRole("button", { name: `收藏 ${title}`, exact: true }).click();
  await expect(row.getByRole("button", { name: `取消收藏 ${title}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await row.getByRole("button", { name: `将 ${title} 添加到歌单`, exact: true }).click();
  const add = page.getByRole("dialog", { name: "添加到歌单" });
  await expect(add.getByRole("option", { name: "跟随曲目默认来源" })).toHaveCount(1);
  await add.getByLabel("歌单名称").fill("待补音频");
  const [saved] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/playlists") && r.request().method() === "POST"),
    add.getByRole("button", { name: "保存", exact: true }).click(),
  ]);
  expect(saved.ok(), await saved.text()).toBe(true);
  const playlist = await saved.json();
  expect(playlist.bindings[0].entries[0].source.trackId).toBe(trackId);
  expect(playlist.bindings[0].entries[0].source.forcedSourceTrackId ?? null).toBeNull();
  await page.goto(`${server.origin}/#/playlists/${playlist.playlistId}`);
  await page.getByRole("button", { name: "更新歌单快照" }).click();
  await expect(row).toContainText(artist);
  await expect(row.getByRole("button", { name: `播放 ${title}` })).toBeDisabled();
  await page.goto(`${server.origin}/#/favorites`);
  await page.reload();
  await expect(row).toContainText("暂无来源");
  await page.goto(`${server.origin}/#/library`);
  await page.getByRole("button", { name: "歌手", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(artist) }).click();
  await expect(row).toContainText(title);
});

test("a playlist can pin a non-default source and later follow the current default", async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await duplicateFixture(page);
  server = fixture.server;
  await page.reload();
  for (const file of ["selected.wav", "second-selected.wav"]) {
    await page.getByRole("checkbox", { name: `选择 ${file}`, exact: true }).check();
  }
  await page.getByRole("button", { name: "合并歌曲", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认合并", exact: true }).click();
  const expand = page.getByRole("button", { name: /^展开 .* 的来源版本$/ });
  await expect(expand).toHaveCount(1);
  const catalog = await (await page.request.get(`${server.origin}/api/v1/library/tracks`)).json();
  const music: MusicTrack = catalog.items.find((item: MusicTrack) => item.selectedSource?.versions?.length === 2);
  const current = music.selectedSource!, other = current.versions!.find((item) => item.sourceTrackId !== current.sourceTrackId)!;
  const row = page.locator(".tracks tbody tr").filter({ has: expand });
  await row.getByRole("button", { name: /添加到歌单$/ }).click();
  const add = page.getByRole("dialog", { name: "添加到歌单" });
  await add.getByLabel("歌单名称").fill("双版本歌单");
  await add.getByRole("combobox", { name: /的歌单播放来源$/ }).selectOption(other.sourceTrackId);
  const [saved] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/playlists") && r.request().method() === "POST"),
    add.getByRole("button", { name: "保存", exact: true }).click(),
  ]);
  expect(saved.ok(), await saved.text()).toBe(true);
  const playlist = await saved.json();
  const entry = playlist.bindings[0].entries[0];
  expect(entry.source).toMatchObject({ trackId: music.trackId, forcedSourceTrackId: other.sourceTrackId });
  await page.goto(`${server.origin}/#/playlists/${playlist.playlistId}`);
  await page.getByRole("button", { name: "更新歌单快照" }).click();
  const play = page.locator(".tracks .track-play");
  async function verifyPlayback(sourceTrackId: string, forced: boolean) {
    await expect(play).toHaveText(music.title);
    const [created] = await Promise.all([
      waitControlResponse(page, (r) => r.url().endsWith("/playback/sessions") && r.request().method() === "POST"),
      play.click(),
    ]);
    expect(created.ok(), await created.text()).toBe(true);
    expect(created.request().postDataJSON()).toMatchObject({ trackId: music.trackId, sourceTrackId });
    expect(created.request().postDataJSON().forcedSourceTrackId ?? null).toBe(forced ? sourceTrackId : null);
    await waitPlaying(page);
  }
  await verifyPlayback(other.sourceTrackId, true);
  await page.getByRole("button", { name: "编辑名称与聚合规则" }).click();
  const editor = page.getByRole("dialog", { name: "编辑歌单" });
  await editor.getByRole("button", { name: "编辑曲目来源" }).click();
  const select = editor.getByRole("combobox", { name: /的歌单播放来源$/ });
  await expect(select).toHaveValue(other.sourceTrackId);
  await select.selectOption("");
  const [changed] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/playlists/${playlist.playlistId}`) && r.request().method() === "PUT"),
    editor.getByRole("button", { name: "保存修改" }).click(),
  ]);
  expect(changed.ok(), await changed.text()).toBe(true);
  expect((await changed.json()).bindings[0].entries[0].entryId).toBe(entry.entryId);
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "更新歌单快照" }).click();
  await expect(page.getByText(/当前快照已发布/)).toBeVisible();
  await verifyPlayback(current.sourceTrackId, false);
});
