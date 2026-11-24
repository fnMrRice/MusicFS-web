import { musicPage } from "../fixtures/music-catalog";
import { routeApi } from "../fixtures/control-mock";
import { expect, test, type Page, type Route } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import type { RecordingCover } from "../../src/api/recording-cover";
import type { SourceTrack } from "../../src/api/types";
import { playback } from "../fixtures/dto";
import { waitPlaying } from "./helpers";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const tracks: SourceTrack[] = ["Small", "Large", "Legacy"].map((name, index) => ({ sourceTrackId: name, providerInstanceId: index ? "archive" : "local",
  displayName: `${name}.wav`, title: "Song", artists: ["Artist"], album: "Album", coverObjectId: name.toLowerCase(), recordingId: "recording",
  durationMs: 30000, codec: "pcm_s16le", container: "wav", bitrateBps: 128000, sampleRateHz: [44100, 48000, null][index],
  availability: "available", assetId: name }));
const initial = (): RecordingCover => ({ recordingId: "recording", revision: 3, coverObjectId: "large", manualObjectId: null,
  candidates: tracks.map((track, index) => ({ objectId: track.coverObjectId!, sourceTrackId: track.sourceTrackId,
    providerInstanceId: track.providerInstanceId, width: [600, 1200, 0][index], height: [600, 1200, 0][index] })) });
function silence(): Buffer {
  const bytes = 8000 * 30 * 2, data = Buffer.alloc(44 + bytes);
  data.write("RIFF", 0); data.writeUInt32LE(36 + bytes, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(bytes, 40); return data;
}
async function mockApi(page: Page, special?: (route: Route, state: ReturnType<typeof initial>) => Promise<boolean>, recording = true, online = false) {
  const state = initial();
  const proxyPath = "/api/v1/source-tracks/Legacy/online-artwork";
  const versions = online ? tracks.map(t => ({ ...t, coverObjectId: null, onlineCoverPath: t.sourceTrackId === "Legacy" ? proxyPath : null })) : tracks;
  const catalog = () => musicPage([{ ...versions[0], recordingId: recording ? "recording" : null,
    coverObjectId: online ? null : state.coverObjectId, onlineCoverPath: online ? proxyPath : null, versions }], `revision-${state.revision}`);
  const writes: { body: { expectedRevision: number; objectId: string | null }; key: string | undefined }[] = [];
  const plays: string[] = [], errors: string[] = [];
  let reads = 0, pages = 0;
  const sound = silence();
  page.on("pageerror", (error) => errors.push(error.message));
  await routeApi(page, async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/recordings/recording/cover")) {
      if (request.method() === "PUT") {
        writes.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
        expect(request.headers()["x-csrf-token"]).toBe("fixture");
        if (special && await special(route, state)) return;
        const body = writes.at(-1)!.body;
        expect(body.expectedRevision).toBe(state.revision);
        state.manualObjectId = body.objectId; state.coverObjectId = body.objectId || "large"; state.revision++;
      } else reads++;
      await route.fulfill({ json: state }); return;
    }
    if (path.includes("/media/") || path === proxyPath) {
      await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=", "base64") }); return;
    }
    if (path.endsWith("/stream")) { await route.fulfill({ contentType: "audio/wav", body: sound }); return; }
    if (request.method() === "DELETE") { await route.fulfill({ status: 204 }); return; }
    let json: unknown = { items: [], nextCursor: null, nextAfter: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "recording-covers" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "user", role: "admin" } };
    if (path.endsWith("/provider-instances")) json = { items: [
      { id: "local", name: "音乐目录", plugin: { id: "local", name: "音乐目录", features: [] }, capabilities: [], availability: "available", roots: [] },
      { id: "archive", name: "备份来源", plugin: { id: "archive", name: "备份来源", features: [] }, capabilities: [], availability: "available", roots: [] },
    ] };
    if (path.endsWith("/library/tracks")) {
      pages++;
      json = catalog();
    }
    if (online && path.endsWith("/me/favorites")) json = { items: [{ musicTrack: catalog().items[0], track: versions[0],
      forcedSourceTrackId: "Small", recordedAt: "2026-11-24T01:00:00Z" }], nextCursor: null, revision: "1" };
    if (online && path.endsWith("/library/tracks/recording")) json = catalog().items[0];
    if (path.endsWith("/media-selection")) json = { bindings: [{ objectId: "small", field: "artwork", current: true, state: "available" }] };
    if (path.endsWith("/playback/sessions") && request.method() === "POST") { plays.push(request.postDataJSON().sourceTrackId); json = playback(); }
    await route.fulfill({ json });
  });
  await page.goto(`${origin}/#/library`);
  await expect(page.getByRole("button", { name: "展开 Song 的来源版本", exact: true })).toHaveAttribute("aria-expanded", "false");
  return { state, writes, plays, errors, reads: () => reads, pages: () => pages };
}

test("group and pinned favorite retain online artwork when the selected local file lacks a cover", async ({ page }) => {
  await mockApi(page, undefined, true, true);
  const artwork = "/api/v1/source-tracks/Legacy/online-artwork";
  await expect(page.locator(".track-title .cover img")).toHaveAttribute("src", artwork);
  await page.getByRole("button", { name: "展开 Song 的来源版本", exact: true }).click();
  await expect(page.locator(".track-version").filter({ hasText: "Legacy.wav" }).locator(".cover img")).toHaveAttribute("src", artwork);
  await page.goto(`${origin}/#/favorites`);
  await expect(page.locator(".track-title .cover img")).toHaveAttribute("src", artwork);
  await page.getByRole("button", { name: "播放 Song", exact: true }).click();
  await waitPlaying(page);
  await expect(page.locator(".now-playing .cover img")).toHaveAttribute("src", artwork);
  await page.getByRole("button", { name: "歌词", exact: true }).click();
  await expect(page.locator(".media-artwork")).toHaveAttribute("src", artwork);
});

test("network rows recover from offline and signed-out snapshots without changing local availability", async ({ page }) => {
  const now = new Date("2026-11-24T02:00:00Z");
  await page.clock.install({ time: now });
  const remote = { ...tracks[0], sourceTrackId: "remote", providerInstanceId: "netease", title: "Online song", recordingId: null };
  const local = { ...tracks[1], title: "Local group", versions: [tracks[1], remote] };
  let state = "offline", requests = 0;
  await routeApi(page, route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = { items: [], nextCursor: null, nextAfter: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "fixture" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "listener", role: "user" } };
    if (path.endsWith("/library/tracks")) json = musicPage([remote, local]);
    if (path.endsWith("/provider-instances")) {
      requests++;
      json = { items: [{ id: "netease", name: "NetEase", sourceType: "network", availability: state,
        accountState: state === "available" ? "authorized" : "authRequired" }] };
    }
    return route.fulfill({ json });
  });
  await page.goto(origin + "/#/library");
  const play = page.getByRole("button", { name: "播放 Online song", exact: true });
  const row = page.getByRole("row").filter({ has: play });
  await expect(play).toBeDisabled();
  await expect(row).toContainText("来源离线");
  await expect(page.getByRole("button", { name: "播放 Local group", exact: true })).toBeEnabled();
  state = "unavailable";
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(row).toContainText("来源需要登录");
  const afterRefresh = requests;
  state = "available";
  await page.clock.setSystemTime(new Date(now.getTime() + 60_000));
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(play).toBeEnabled();
  expect(requests).toBe(afterRefresh + 1);
  await page.reload();
  await expect(play).toBeEnabled();
});
async function open(page: Page) {
  await page.getByRole("button", { name: "Song 的更多操作", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "选择封面", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择封面", exact: true });
  await expect(dialog.getByRole("radio", { name: "自动选择最高分辨率", exact: true })).toBeVisible();
  return dialog;
}

test("manual and automatic artwork stay consistent in library and player without restarting playback", async ({ page }, info) => {
  const mock = await mockApi(page);
  const row = page.locator(".tracks tbody tr").first();
  await expect(row.locator(".cover img")).toHaveAttribute("src", "/api/v1/media/large");
  await page.getByRole("button", { name: "播放 Song", exact: true }).click();
  await waitPlaying(page);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const stream = await page.locator("audio").getAttribute("src");
  const player = page.getByRole("region", { name: "播放器", exact: true });
  const dialog = await open(page);
  await expect(dialog.getByRole("radio", { name: "自动选择最高分辨率", exact: true })).toBeChecked();
  await expect(dialog).toContainText("600 × 600"); await expect(dialog).toContainText("1200 × 1200");
  await expect(dialog).toContainText("尺寸未知"); await expect(dialog).toContainText("备份来源");
  await dialog.getByRole("radio", { name: "选择 Small.wav 的封面", exact: true }).check();
  await dialog.getByRole("button", { name: "保存封面", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.locator(".cover img")).toHaveAttribute("src", "/api/v1/media/small");
  await expect(player.locator(".now-playing .cover img")).toHaveAttribute("src", "/api/v1/media/small");
  await expect.poll(mock.pages).toBeGreaterThan(1);
  const again = await open(page);
  await expect(again.getByRole("radio", { name: "选择 Small.wav 的封面", exact: true })).toBeChecked();
  await expect(again.locator(".recording-cover-choice img")).toHaveCount(3);
  expect(await again.locator(".recording-cover-choice img").evaluateAll((images) => images.map((image) => image.getAttribute("src")))).toEqual([
    "/api/v1/media/small", "/api/v1/media/large", "/api/v1/media/legacy",
  ]);
  await again.getByRole("radio", { name: "自动选择最高分辨率", exact: true }).check();
  await again.getByRole("button", { name: "保存封面", exact: true }).click();
  await expect(player.locator(".now-playing .cover img")).toHaveAttribute("src", "/api/v1/media/large");
  await player.getByRole("button", { name: "歌词", exact: true }).click();
  await expect(player.locator(".media-artwork")).toHaveAttribute("src", "/api/v1/media/large");
  const lyrics = player.getByRole("dialog", { name: "歌词", exact: true });
  await expect(lyrics.getByText("暂无歌词", { exact: true })).toBeVisible();
  await expect(lyrics).not.toContainText("此曲目暂无可用歌词。");
  await expect(lyrics).not.toContainText("展示当前来源已选用的歌词；暂不进行逐句定位。");
  await lyrics.screenshot({ path: info.outputPath("lyrics-empty.png") });
  await player.getByRole("button", { name: "关闭面板", exact: true }).click();
  mock.state.coverObjectId = "legacy"; mock.state.revision++;
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(row.locator(".cover img")).toHaveAttribute("src", "/api/v1/media/legacy");
  await expect(player.locator(".now-playing .cover img")).toHaveAttribute("src", "/api/v1/media/legacy");
  await player.getByRole("button", { name: "歌词", exact: true }).click();
  await expect(player.locator(".media-artwork")).toHaveAttribute("src", "/api/v1/media/legacy");
  await expect(lyrics.getByText("暂无歌词", { exact: true })).toBeVisible();
  await expect(lyrics).not.toContainText("此曲目暂无可用歌词。");
  await expect(lyrics).not.toContainText("展示当前来源已选用的歌词；暂不进行逐句定位。");
  expect(mock.writes.map((write) => write.body)).toEqual([{ expectedRevision: 3, objectId: "small" }, { expectedRevision: 4, objectId: null }]);
  expect(mock.plays).toEqual(["Small"]);
  await expect(page.locator("audio")).toHaveAttribute("src", stream!);
  await player.getByRole("button", { name: "关闭面板", exact: true }).click();
  await page.getByRole("button", { name: "展开 Song 的来源版本", exact: true }).click();
  const versions = page.locator(".track-versions-list");
  await expect(versions).not.toContainText("自动选择可用版本中码率最高的");
  await expect(versions.getByRole("button", { name: "选择封面", exact: true })).toHaveCount(0);
  for (const [index, sampleRate] of ["44.1 kHz", "48 kHz", "采样率未知"].entries()) {
    const version = versions.locator(".track-version").nth(index);
    await expect(version.locator(".track-version-quality")).toContainText(sampleRate);
    await expect(version.getByRole("button", { name: /^查看 .* 的详情$/ })).toHaveText("详情");
    await expect(version.getByRole("button", { name: /^将 .* 设为默认版本$/ })).toHaveText("设为默认");
  }
  await versions.getByRole("button", { name: "Small.wav 的更多操作", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "选择封面", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await versions.screenshot({ path: info.outputPath("source-versions.png") });
  expect(mock.errors).toEqual([]);
});

test("changed candidates require refreshing before another write", async ({ page }) => {
  let conflict = true;
  const mock = await mockApi(page, async (route, state) => {
    if (!conflict) return false;
    conflict = false; state.revision = 7; state.manualObjectId = "small";
    state.candidates = state.candidates.filter((candidate) => candidate.objectId !== "small");
    await route.fulfill({ status: 409, json: { error: { code: "RESOURCE_CHANGED" } } }); return true;
  });
  const dialog = await open(page);
  await dialog.getByRole("radio", { name: "选择 Small.wav 的封面", exact: true }).check();
  await dialog.getByRole("button", { name: "保存封面", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("已发生变化");
  await expect(dialog.getByRole("radio", { name: "自动选择最高分辨率", exact: true })).toBeDisabled();
  expect(mock.writes).toHaveLength(1);
  await dialog.getByRole("button", { name: "刷新封面后重新选择", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "选择 Small.wav 的封面", exact: true })).toHaveCount(0);
  await expect(dialog).toContainText("原手动封面已不可用");
  await dialog.getByRole("radio", { name: "自动选择最高分辨率", exact: true }).check();
  await dialog.getByRole("button", { name: "保存封面", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.writes[1].body).toEqual({ expectedRevision: 7, objectId: null });
  expect(mock.writes[1].key).not.toBe(mock.writes[0].key);
});

test("uncertain saves retain the same idempotency key and choice on mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let failed = false;
  const mock = await mockApi(page, async (route) => {
    if (failed) return false;
    failed = true; await route.abort("failed"); return true;
  });
  const dialog = await open(page);
  await dialog.getByRole("radio", { name: "选择 Small.wav 的封面", exact: true }).check();
  await dialog.getByRole("button", { name: "保存封面", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "自动选择最高分辨率", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "继续确认封面选择", exact: true })).toBeEnabled();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.screenshot({ path: info.outputPath("recording-cover-mobile.png") });
  await dialog.getByRole("button", { name: "继续确认封面选择", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.writes).toHaveLength(2); expect(mock.writes[0].key).toBeTruthy(); expect(mock.writes[1]).toEqual(mock.writes[0]);
});

test("source rows without a recording cannot select recording artwork", async ({ page }) => {
  const mock = await mockApi(page, undefined, false);
  await page.getByRole("button", { name: "Song 的更多操作", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "选择封面", exact: true })).toHaveCount(0);
  expect(mock.reads()).toBe(0); expect(mock.writes).toHaveLength(0);
});
