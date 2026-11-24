import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { routeApi } from "../fixtures/control-mock";
import { instanceIds, neteasePlugin } from "../fixtures/plugins";
import { musicTrack } from "../fixtures/music-catalog";
import { track } from "../fixtures/dto";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  origin = server.resolvedUrls!.local[0];
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

async function failedFavoriteLink(page: Page) {
  const source = { instanceId: instanceIds.netease, accountId: "cloud-account", accountRevision: "1",
    name: "测试用户", platform: "netease", availability: "available", plugin: neteasePlugin,
    capabilities: ["playlist.list", "playlist.addTracks"].map(name => ({ name, supported: true, reason: "" })) };
  const item = { externalId: "210", title: "云端收藏", trackCount: 1, sourceUrl: "", writable: true };
  const state = { latest: "previous", state: "queued", favorite: false, favoriteReads: 0, submissions: 0 };
  const control = await routeApi(page, route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let json: unknown = { items: [], nextCursor: null, nextAfter: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "fixture" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "csrf", user: { id: "listener", role: "user" } };
    if (path.endsWith("/online-instances")) json = { items: [source] };
    if (path.endsWith(`/online-instances/${source.instanceId}/playlists`))
      json = { items: [item], nextCursor: null, observedAt: "2026-11-24T00:00:00Z", consistency: "unversioned" };
    if (path.endsWith("/playlist-links")) json = { items: [{ platform: "netease", instanceId: source.instanceId,
      accountId: source.accountId, externalId: item.externalId, playlistId: "favorites", pendingCount: 0, jobId: state.latest }] };
    if (path.endsWith("/remote-playlists/binding")) json = { playlistId: "binding", externalId: item.externalId,
      instanceId: source.instanceId, bindingRevision: 7, title: item.title, revision: 2, stale: true, jobId: state.latest };
    if (path.endsWith("/remote-playlists/binding/sync-jobs")) {
      expect(req.method()).toBe("POST");
      expect(req.postDataJSON()).toEqual({ expectedBindingRevision: 7 });
      expect(req.headers()["idempotency-key"]).toBeTruthy();
      expect(req.headers()["x-csrf-token"]).toBe("csrf");
      state.submissions++;
      state.latest = "replacement";
      return route.fulfill({ status: 202, json: { jobId: state.latest, merged: false } });
    }
    if (path.endsWith("/remote-playlist-sync-jobs/previous")) json = { jobId: "previous", playlistId: "binding",
      bindingRevision: 4, state: "failed", resultRevision: null, error: { code: "RATE_LIMITED", retryAfter: 90 } };
    if (path.endsWith("/remote-playlist-sync-jobs/replacement")) json = { jobId: "replacement", playlistId: "binding",
      bindingRevision: 7, state: state.state, resultRevision: state.state === "succeeded" ? 3 : null, error: null };
    if (path.endsWith("/me/favorites")) {
      const song = { ...track, title: "已同步曲目", displayName: "已同步曲目", providerInstanceId: source.instanceId };
      state.favoriteReads++;
      json = { revision: state.favorite ? "2" : "1", nextCursor: null, items: state.favorite
        ? [{ track: song, musicTrack: musicTrack(song), forcedSourceTrackId: null, recordedAt: "2026-11-24T00:00:00Z" }] : [] };
    }
    return route.fulfill({ json });
  });
  await page.goto(`${origin}#/playlists`);
  const row = page.getByRole("region", { name: "网易云音乐 · 测试用户 的歌单", exact: true }).locator(".remote-row").filter({ hasText: "云端收藏" });
  await expect(row.getByRole("status")).toContainText("歌单同步触发请求上限，服务端会在冷却后自动重试。");
  await expect(row.getByRole("status")).toContainText("90 秒");
  return { row, state, changed: () => control.event("activity.changed", { resources: ["playlistSync"] }) };
}

test("a failed linked favorite can retry with the current binding revision and updates the open favorites", async ({ page }) => {
  const { row, state, changed } = await failedFavoriteLink(page);
  await row.getByRole("button", { name: "重试同步" }).click();
  await expect(row.getByRole("status")).toContainText("排队中");
  state.state = "running";
  changed();
  await expect(row.getByRole("status")).toContainText("同步中");
  await expect(row.getByRole("button", { name: "重试同步" })).toHaveCount(0);
  const personal = page.locator("aside").getByRole("link", { name: "我的收藏", exact: true });
  await personal.click();
  await expect(page.getByText("暂无收藏音乐", { exact: true })).toBeVisible();
  state.state = "succeeded";
  state.favorite = true;
  changed();
  await expect(page.getByRole("button", { name: "播放 已同步曲目", exact: true })).toBeVisible();
  expect(state.submissions).toBe(1);
});

test("the account playlist follows an automatic retry and refreshes linked favorites only on success", async ({ page }) => {
  const { row, state, changed } = await failedFavoriteLink(page);
  const before = state.favoriteReads;
  state.latest = "replacement";
  changed();
  await expect(row.getByRole("status")).toContainText("排队中");
  await expect(row.getByRole("button", { name: "重试同步" })).toHaveCount(0);
  expect(state.favoriteReads).toBe(before);
  state.state = "succeeded";
  state.favorite = true;
  changed();
  await expect(row.getByRole("status")).toContainText("已完成");
  await expect.poll(() => state.favoriteReads).toBe(before + 1);
  expect(state.submissions).toBe(0);
});

test("concurrent playlist syncs update independently on push and reconnect without resubmitting", async ({ page }) => {
  const jobs = new Map(["first", "second"].map(id => [id, { id, state: "queued", submissions: 0, reads: 0 }]));
  let lists = 0;
  const playlist = (id: string) => {
    const completed = jobs.get(id)!.state === "succeeded";
    return { playlistId: id, instanceId: "source", externalId: id, title: `Playlist ${id}`, bindingRevision: 5,
      revision: completed ? 1 : 0, stale: !completed, lastSuccessAt: null, error: null };
  };
  const control = await routeApi(page, route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = { items: [], nextCursor: null, nextAfter: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "fixture" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "user", role: "user" } };
    if (path.endsWith("/tasks")) json = { items: [], nextCursor: null, activeCount: 0 };
    if (path.endsWith("/remote-playlists")) {
      ++lists;
      json = { items: Array.from(jobs.keys(), playlist), nextAfter: null };
    }
    for (const job of jobs.values()) {
      if (path.endsWith(`/remote-playlists/${job.id}`)) json = playlist(job.id);
      if (path.endsWith(`/remote-playlists/${job.id}/sync-jobs`)) {
        ++job.submissions;
        expect(route.request().method()).toBe("POST");
        expect(route.request().postDataJSON()).toEqual({ expectedBindingRevision: 5 });
        return route.fulfill({ status: 202, json: { jobId: job.id } });
      }
      if (path.endsWith(`/remote-playlist-sync-jobs/${job.id}`)) {
        ++job.reads;
        json = { jobId: job.id, state: job.state, resultRevision: job.state === "succeeded" ? 1 : null, error: null };
      }
    }
    return route.fulfill({ json });
  });

  await page.clock.install(); await page.goto(`${origin}#/playlists`);
  const row = (id: string) => page.locator(".remote-row").filter({ hasText: `Playlist ${id}` });
  const sync = (id: string) => row(id).getByRole("button", { name: "同步", exact: true });
  for (const job of jobs.values()) {
    await sync(job.id).click();
    await expect(row(job.id).getByRole("status")).toContainText("排队中");
  }
  const reads = () => Array.from(jobs.values(), job => job.reads);
  const initialReads = reads(), initialLists = lists;
  await page.clock.fastForward(6000);
  expect(reads()).toEqual(initialReads);

  jobs.get("first")!.state = "succeeded";
  jobs.get("second")!.state = "running";
  control.event("activity.changed", { resources: ["playlistSync"] });
  await expect(row("first")).toContainText("已有快照");
  await expect(sync("first")).toBeEnabled();
  await expect(row("second").getByRole("status")).toContainText("同步中");
  await expect(sync("second")).toBeDisabled();

  const sessionCheck = page.waitForRequest(request => request.url().endsWith("/auth/session"));
  control.disconnect(); await sessionCheck;
  jobs.get("second")!.state = "succeeded";
  await page.clock.runFor(1000);
  await expect(row("second")).toContainText("已有快照");
  await expect(sync("second")).toBeEnabled();
  expect(lists).toBe(initialLists);
  expect(Array.from(jobs.values(), job => job.submissions)).toEqual([1, 1]);
});
