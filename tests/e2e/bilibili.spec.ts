import { test, expect, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import type { Playback } from "../../src/api/types";
import { audioFixture } from "../fixtures/audio";
import { routeApi } from "../fixtures/control-mock";
import { playback as fixturePlayback } from "../fixtures/dto";

const origin = "http://127.0.0.1:18158";
const instance = "fb663e04-b0eb-4b69-bbf5-920b30559459";
const external = "video:BV13x41117TL:14694589";
const track = { externalId: external, title: "Public video · P1", artists: [], album: "", durationMs: 120000, sourceUrl: "https://www.bilibili.com/video/BV13x41117TL?cid=14694589" };
const playlist = { externalId: "favorite:123", title: "Public favorites", trackCount: 3, sourceUrl: "https://www.bilibili.com/medialist/detail/ml123" };
const source = { instanceId: instance, name: "Bilibili", platform: "bilibili", authentication: "anonymous", sourceType: "network", availability: "available", accountId: "",
  plugin: { id: "musicfs.plugin.source.bilibili", name: "Bilibili", localizedNames: { "zh-CN": "哔哩哔哩" }, features: ["music-source"] },
  capabilities: ["search.tracks", "playlist.observe", "playlist.tracks", "stream.resolve"].map((name) => ({ name, supported: true, reason: "Public content" })) };
let server: PreviewServer;
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18158, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); });

async function mock(page: Page, playback?: Playback) {
  const calls: string[] = [];
  await routeApi(page, async (route) => {
    const url = new URL(route.request().url());
    const path = decodeURIComponent(url.pathname);
    calls.push(path);
    if (playback && path === playback.streamUrl)
      return route.fulfill({ status: 200, contentType: "audio/wav", headers: { "Cache-Control": "no-store" }, body: audioFixture() });
    let json: unknown = { items: [], nextCursor: null, nextAfter: null };
    if (path.endsWith("/me/favorites")) json = { items: [], nextCursor: null, revision: "1" };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "bilibili-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "test", user: { id: "admin", role: "admin" } };
    if (path.endsWith("/online-instances")) json = { items: [source] };
    if (path.endsWith("/search")) json = url.searchParams.get("kind") === "playlists" ? { playlists: [playlist] } : { tracks: [track], nextCursor: null, truncated: false };
    if (path.endsWith("/playlists/favorite:123")) json = { playlist, entries: [{ position: 0, externalTrackId: external }, { position: 1, externalTrackId: external }, { position: 2, externalTrackId: "unavailable:2:99" }], complete: true, observedAt: "2026-10-23T00:00:00Z" };
    if (path.endsWith("/playlists/favorite:123/tracks")) json = { playlist, items: [{ position: 0, externalId: external, track, errorCode: null }, { position: 1, externalId: external, track, errorCode: null }, { position: 2, externalId: "unavailable:2:99", track: null, errorCode: "NOT_FOUND" }], nextCursor: null, complete: true };
    if (path.endsWith("/resolve")) json = { sourceTrackId: "resolved-track", providerInstanceId: instance, title: track.title, displayName: track.title, artists: [], durationMs: 120000, codec: null, container: null, bitrateBps: null, availability: "available", assetId: "resolved-asset" };
    if (path.endsWith("/playback/sessions") && route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({ sourceTrackId: "resolved-track" });
      expect(playback).toBeDefined();
      json = playback;
    }
    await route.fulfill({ json });
  });
  return calls;
}

test("anonymous link lookup offers queue actions without requesting a platform account", async ({ page }) => {
  const calls = await mock(page);
  await page.goto(`${origin}/#/search?source=${instance}&q=BV13x41117TL`);
  await expect(page.getByText(track.title, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "播放 Public video · P1", exact: true })).toBeEnabled();
  expect(calls.some((path) => path.endsWith("/resolve"))).toBe(false);
  await page.getByRole("button", { name: "将 Public video · P1 加入队列", exact: true }).click();
  await expect.poll(() => calls.filter((path) => path.endsWith("/resolve")).length).toBe(1);
  expect(calls.some((path) => path.endsWith("/account"))).toBe(false);
  expect(calls.some((path) => path.includes("/stream"))).toBe(false);
});

test("anonymous network source starts real HTML audio without seek support", async ({ page }, info) => {
  // 合成 WAV 只验收浏览器播放链，不表示已经访问或验证 Bilibili 音轨。
  const descriptor: Playback = { ...fixturePlayback("bilibili-synthetic"), assetId: "resolved-asset", deliveryMode: "proxy", seekMode: "none", seekableRange: null, resumeDecision: "continue" };
  const calls = await mock(page, descriptor);
  await page.goto(`${origin}/#/search?source=${instance}&q=BV13x41117TL`);
  await expect(page.getByText(track.title, { exact: true })).toBeVisible();
  expect(calls.some((path) => path.includes("/stream") || path.endsWith("/playback/sessions"))).toBe(false);
  await page.evaluate(() => {
    const events = { playing: 0, seeking: 0 };
    (window as unknown as { musicfsSyntheticAudioEvents: typeof events }).musicfsSyntheticAudioEvents = events;
    document.addEventListener("playing", () => { ++events.playing; }, true);
    document.addEventListener("seeking", () => { ++events.seeking; }, true);
  });
  await page.getByRole("button", { name: "播放 Public video · P1", exact: true }).click();
  const audio = page.locator("audio");
  await expect(audio).toHaveCount(1);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => !element.paused && element.readyState >= 2 && element.currentTime > 0.25)).toBe(true);
  const startedAt = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(startedAt + 0.3);
  await expect(page.getByRole("slider", { name: "曲目进度", exact: true })).toBeDisabled();
  const events = await page.evaluate(() => (window as unknown as { musicfsSyntheticAudioEvents: { playing: number; seeking: number } }).musicfsSyntheticAudioEvents);
  expect(events.playing).toBeGreaterThan(0);
  expect(events.seeking).toBe(0);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.error)).toBeNull();
  expect(calls.filter((path) => path.endsWith("/resolve"))).toHaveLength(1);
  expect(calls.filter((path) => path.endsWith("/playback/sessions"))).toHaveLength(1);
  expect(calls).toContain(descriptor.streamUrl);
  expect(calls.some((path) => /\/(?:seek|recover|account)$/.test(path))).toBe(false);
  await page.screenshot({ path: info.outputPath("bilibili-synthetic-playback.png"), fullPage: true });
});

test("public collection preview keeps duplicate parts and missing entries", async ({ page }, info) => {
  const calls = await mock(page);
  await page.goto(`${origin}/#/sources/${instance}/playlists`);
  await page.getByLabel("公开收藏夹或音频歌单").fill("favorite:123");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByRole("heading", { name: playlist.title })).toBeVisible();
  await expect(page.locator("table.tracks tbody tr")).toHaveCount(3);
  await expect(page.getByText("内容已失效或不可用", { exact: true })).toBeVisible();
  expect(calls.some((path) => path.endsWith("/resolve") || path.endsWith("/account") || path.endsWith("/remote-playlists") && !path.includes("/online-instances"))).toBe(false);
  await page.screenshot({ path: info.outputPath("bilibili-collection.png"), fullPage: true });
});
