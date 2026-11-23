import { expect, test } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { instanceIds, neteasePlugin } from "../fixtures/plugins";
import { audioFixture } from "../fixtures/audio";
import { routeApi } from "../fixtures/control-mock";
import { deferred, playback, track } from "../fixtures/dto";
import { waitPlaying } from "./helpers";

const origin = "http://127.0.0.1:18289";
let server: PreviewServer;
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18289, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

test("NetEase playlist pages recheck the server day and only force a snapshot on explicit refresh", async ({ page }) => {
  const id = instanceIds.netease;
  const path = `/api/v1/online-instances/${id}/playlists`;
  let day = 1;
  const listReads: string[] = [], details: string[] = [], trackReads: string[] = [];
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    const playlist = { externalId: "mix", title: `Mix ${day}`, writable: true, trackCount: 2, coverUrl: null, sourceUrl: "" };
    const observedAt = `2026-11-0${day}T09:00:00Z`;
    let json: unknown = { items: [], nextAfter: null };
    if (url.pathname.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "fixture" };
    if (url.pathname.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "listener", role: "user" } };
    if (url.pathname.endsWith("/online-instances")) json = { items: [{ instanceId: id, accountId: "listener", accountRevision: "1",
      name: "Listener", plugin: neteasePlugin, platform: "netease", availability: "available",
      capabilities: [{ name: "playlist.list", supported: true, reason: "" }] }] };
    if (url.pathname === path) {
      listReads.push(url.search);
      json = { items: [cursor ? { ...playlist, externalId: "saved", title: `Saved ${day}`, writable: false } : playlist],
        consistency: "unversioned", observedAt, nextCursor: cursor ? null : "next" };
    }
    if (url.pathname === path + "/mix") {
      details.push(url.search);
      const entries = ["0", "1"].map((externalTrackId, position) => ({ externalTrackId, position }));
      json = { playlist, entries, complete: true, observedAt };
    }
    if (url.pathname === path + "/mix/tracks") {
      trackReads.push(url.search);
      const position = cursor ? 1 : 0;
      const track = { externalId: String(position), title: `Track ${day}.${position}`, artists: [], durationMs: null };
      json = { playlist, items: [{ position, externalId: track.externalId, track }], nextCursor: cursor ? null : "next" };
    }
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/playlists`);
  const group = page.getByRole("region", { name: "网易云音乐 · Listener 的歌单" });
  const mix = group.locator(`a[href="#/discover/${id}/mix"]`);
  const more = group.getByRole("button", { name: "加载更多歌单" });
  await expect(mix).toContainText("Mix 1");
  await more.click();
  await group.getByRole("button", { name: /收藏的歌单/ }).click();
  await expect(group.getByRole("link", { name: /Saved 1/ })).toBeVisible();
  await page.goto(`${origin}/#/search`);
  await expect(page.getByRole("combobox", { name: "搜索来源" })).toBeVisible();
  const reopen = page.waitForResponse((res) => new URL(res.url()).pathname === path && !new URL(res.url()).searchParams.has("cursor"));
  await page.goto(`${origin}/#/playlists`);
  await reopen;
  await expect(group.getByRole("link", { name: /Saved 1/ })).toBeVisible();
  day = 2;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(mix).toContainText("Mix 2");
  await expect(group.getByRole("link", { name: /Saved 1/ })).toHaveCount(0);
  await group.getByRole("button", { name: "刷新歌单" }).click();
  await expect.poll(() => listReads.filter((query) => query.includes("refresh=true")).length).toBe(1);
  await more.click();
  await expect(group.getByRole("link", { name: /Saved 2/ })).toBeVisible();
  expect(listReads.filter((query) => query.includes("cursor")).every((query) => !query.includes("refresh"))).toBe(true);
  await mix.click();
  await expect(page.getByRole("cell", { name: "Track 2.1", exact: true })).toBeVisible();
  const sameDay = page.waitForResponse((res) => new URL(res.url()).pathname === path + "/mix");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await sameDay;
  await expect(page.getByRole("cell", { name: "Track 2.1", exact: true })).toBeVisible();
  expect(trackReads).toHaveLength(2);
  day = 3;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Mix 3" })).toBeVisible();
  const refreshed = await page.evaluate(() => new Date("2026-11-03T09:00:00Z").toLocaleString("zh-CN"));
  await expect(page.locator(".detail-heading").getByText(`2 首 · 刷新时间：${refreshed}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "播放全部", exact: true })).toBeDisabled();
  await expect(page.locator("#page-scroll")).not.toContainText(/本次读取|本次观测到|观测时间/);
  await expect(page.getByRole("cell", { name: "Track 3.1", exact: true })).toBeVisible();
  expect(details.every((query) => query === "")).toBe(true);
  day = 4;
  await page.getByRole("button", { name: "刷新歌单", exact: true }).click();
  await expect(page.locator(".detail-heading time")).toHaveAttribute("datetime", "2026-11-04T09:00:00Z");
  await expect(page.getByRole("cell", { name: "Track 4.1", exact: true })).toBeVisible();
  expect(details.at(-1)).toBe("?refresh=true");
  expect(trackReads).toHaveLength(6);
  expect(trackReads.every((query) => !query.includes("refresh"))).toBe(true);
});

test("play all starts the first available track and queues the whole online playlist in order", async ({ page }) => {
  const source = instanceIds.netease;
  const sourcePath = `/api/v1/online-instances/${source}`;
  const playlistPath = sourcePath + "/playlists/mix";
  const playlist = { externalId: "mix", title: "Night mix", trackCount: 4, coverUrl: null, sourceUrl: "" };
  const entries = ["missing", "A", "B", "A"].map((externalTrackId, position) => ({ externalTrackId, position }));
  const laterPage = deferred<void>();
  const starts: string[] = [];
  const sound = audioFixture();
  await routeApi(page, async (route) => {
    const request = route.request(), { pathname, searchParams } = new URL(request.url());
    let json: unknown = { items: [], nextAfter: null };
    if (pathname.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "fixture" };
    if (pathname.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "listener", role: "user" } };
    if (pathname.endsWith("/online-instances")) json = { items: [{
      instanceId: source, accountId: "listener", accountRevision: "1", name: "Listener", plugin: neteasePlugin,
      platform: "netease", availability: "available", capabilities: [{ name: "stream.resolve", supported: true, reason: "" }],
    }] };
    if (pathname === playlistPath) json = { playlist, entries, complete: true, observedAt: "2026-11-23T00:00:00Z" };
    if (pathname === playlistPath + "/tracks") {
      const next = searchParams.has("cursor");
      if (next) await laterPage.promise;
      const items = (next ? entries.slice(2) : entries.slice(0, 2)).map(({ externalTrackId: externalId, position }) => ({
        position, externalId, track: externalId === "missing" ? null : { externalId, title: externalId, artists: [], durationMs: 30_000 },
        errorCode: externalId === "missing" ? "NOT_FOUND" : null,
      }));
      json = { playlist, items, nextCursor: next ? null : "next", complete: true };
    }
    if (pathname.startsWith(sourcePath + "/tracks/") && pathname.endsWith("/resolve")) {
      const external = pathname.split("/").at(-2)!;
      if (external === "missing") return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
      json = { ...track, sourceTrackId: external, assetId: "asset-" + external, providerInstanceId: source, title: external };
    }
    if (pathname.endsWith("/playback/sessions") && request.method() === "POST") {
      const { sourceTrackId } = request.postDataJSON();
      starts.push(sourceTrackId);
      json = { ...playback(), sourceTrackId, assetId: "asset-" + sourceTrackId };
    }
    if (pathname.endsWith("/stream")) return route.fulfill({ contentType: "audio/wav", body: sound });
    return route.fulfill({ json });
  });
  try {
    await page.goto(`${origin}/#/discover/${source}/mix`);
    await expect(page.getByRole("cell", { name: "A", exact: true })).toBeVisible();
    await page.locator(".detail-heading").getByRole("button", { name: "播放全部", exact: true }).click();
    await waitPlaying(page);
    await page.getByRole("button", { name: "播放队列", exact: true }).click();
    const queued = page.locator(".queue-list button");
    await expect(queued).toHaveText(["A", "B", "A"]);
    await expect(queued.first()).toHaveAttribute("aria-current", "true");
    expect(starts).toEqual(["A"]);
  } finally {
    laterPage.resolve();
  }
});
