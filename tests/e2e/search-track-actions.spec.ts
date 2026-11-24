import { expect, test } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { routeApi } from "../fixtures/control-mock";
import { track } from "../fixtures/dto";
import { musicTrack } from "../fixtures/music-catalog";
import { instanceIds, neteasePlugin } from "../fixtures/plugins";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Missing preview address");
  origin = "http://127.0.0.1:" + address.port;
});
test.afterAll(async () => { await new Promise<void>(resolve => server.httpServer.close(() => resolve())); });

test("online search shows compact actions and shares persistent favorites with the library", async ({ page }) => {
  const instance = instanceIds.netease;
  const source = { ...track, sourceTrackId: "online-source", recordingId: "recording", title: "海潮", providerInstanceId: instance };
  const saved = {
    musicTrack: { ...musicTrack(source), sources: [{
      providerInstanceId: instance, sourceId: "102", sourceTrackId: source.sourceTrackId,
      pluginId: neteasePlugin.id, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    }] }, track: source, forcedSourceTrackId: null, recordedAt: "2026-01-01T00:00:00Z",
  };
  const writes: string[] = [];
  let stored = false, resolves = 0;
  await routeApi(page, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let json: unknown = { items: [], nextAfter: null, nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "fixture" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "test", user: { id: "listener", role: "user" } };
    if (path.endsWith("/online-instances")) json = { items: [{
      instanceId: instance, platform: "netease", name: "Test", accountId: "account", availability: "available", plugin: neteasePlugin,
      capabilities: ["stream.resolve", "search.tracks", "playlist.addTracks"].map(name => ({ name, supported: true, reason: "" })),
    }] };
    if (path.endsWith("/search")) json = { nextCursor: null, truncated: false,
      tracks: [{ externalId: "102", title: source.title, artists: [], album: "", durationMs: 120000, sourceUrl: "" }] };
    if (path.endsWith("/me/favorites")) json = { items: stored ? [saved] : [], nextCursor: null, revision: "1" };
    if (path.endsWith("/tracks/102/resolve")) { ++resolves; json = source; }
    if (path.includes("/me/favorites/")) {
      writes.push(request.method() + " " + path.split("/").at(-1));
      if (request.method() === "DELETE") { stored = false; return route.fulfill({ status: 204 }); }
      stored = true;
      json = saved;
    }
    return route.fulfill({ json });
  });
  // 局域网 HTTP 页面也能通过按钮为在线曲目建档并收藏。
  await page.addInitScript(() => Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined }));
  await page.goto(origin + "/#/search?source=" + instance + "&q=海潮");
  const row = page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "选择 海潮" }) });
  const buttons = row.getByRole("cell").last().getByRole("button");
  await expect(buttons).toHaveCount(4);
  expect(await buttons.evaluateAll(nodes => nodes.map(n => n.getAttribute("aria-label")))).toEqual([
    "播放 海潮", "收藏 海潮", "将 海潮 加入队列", "海潮 的更多操作",
  ]);
  for (const width of [1300, 390]) {
    await page.setViewportSize({ width, height: 850 });
    const tops = await buttons.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top));
    expect(new Set(tops).size).toBe(1);
    await expect(buttons.locator("svg")).toHaveCount(4);
  }
  const more = buttons.last();
  await more.focus();
  await page.keyboard.press("Enter");
  const add = page.getByRole("menuitem", { name: "添加到歌单", exact: true });
  await expect(add).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  expect(resolves).toBe(0);
  const heart = buttons.nth(1);
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  expect(writes).toEqual(["PUT online-source"]);
  expect(resolves).toBe(1);
  await page.reload();
  await expect(heart).toHaveAccessibleName("取消收藏 海潮");
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  expect(writes).toEqual(["PUT online-source", "DELETE recording"]);
  expect(resolves).toBe(1);
});
