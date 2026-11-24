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

async function linkedPlaylist(page: Page, options: {
  target?: "favorites" | "local"; previous?: "succeeded" | "failed"; linked?: boolean; previousJob?: boolean; legacy?: boolean;
} = {}) {
  const { target = "favorites", previous = "failed", linked = true, previousJob = true, legacy = false } = options;
  const source = { instanceId: instanceIds.netease, accountId: "cloud-account", accountRevision: "1",
    name: "测试用户", platform: "netease", availability: "available", plugin: neteasePlugin,
    capabilities: ["playlist.list", "playlist.addTracks"].map(name => ({ name, supported: true, reason: "" })) };
  const item = { externalId: "210", title: "云端收藏", trackCount: 1, sourceUrl: "", writable: true };
  const state = { latest: previousJob ? "previous" : undefined, state: "queued", added: false, favoriteReads: 0, submissions: 0, imports: 0 };
  const song = { ...track, title: "已同步曲目", displayName: "已同步曲目", providerInstanceId: source.instanceId };
  const control = await routeApi(page, route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let json: unknown = { items: [], nextCursor: null, nextAfter: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "fixture" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "csrf", user: { id: "listener", role: "user" } };
    if (path.endsWith("/online-instances")) json = { items: [source] };
    if (path.endsWith(`/online-instances/${source.instanceId}/playlists`))
      json = { items: [item], nextCursor: null, observedAt: "2026-11-24T00:00:00Z", consistency: "unversioned" };
    const preview = `/online-instances/${source.instanceId}/playlists/${item.externalId}`;
    if (path.endsWith(preview) || path.endsWith(preview + "/tracks")) {
      const titles = state.added ? ["原有歌曲", "新加入的歌曲"] : ["原有歌曲"];
      const tracks = titles.map((title, position) => ({ externalId: String(position + 100), title, artists: ["测试歌手"] }));
      const playlist = { ...item, trackCount: titles.length };
      json = path.endsWith("/tracks") ? { playlist, complete: true, nextCursor: null,
        items: tracks.map((track, position) => ({ position, externalId: track.externalId, track, errorCode: null })) } :
        { playlist, complete: true, observedAt: state.added ? "2026-11-24T00:01:00Z" : "2026-11-24T00:00:00Z",
          entries: tracks.map((track, position) => ({ position, externalTrackId: track.externalId })) };
    }
    if (path.endsWith(`/online-instances/${source.instanceId}/account`))
      json = { state: "signedIn", accountId: source.accountId };
    if (path.endsWith("/playlist-links")) json = { items: linked ? [{ platform: "netease", instanceId: source.instanceId,
      accountId: source.accountId, externalId: item.externalId, playlistId: target, remotePlaylistId: legacy ? undefined : "binding",
      pendingCount: 0, jobId: state.latest }] : [] };
    if (path.endsWith("/remote-playlists") && req.method() === "POST") {
      expect(req.postDataJSON()).toEqual({ instanceId: source.instanceId, externalId: item.externalId, accountId: source.accountId });
      state.imports++;
      state.latest = "replacement";
      return route.fulfill({ status: 202, json: { playlist: { playlistId: "binding", externalId: item.externalId,
        instanceId: source.instanceId, bindingRevision: 7, title: item.title }, merged: true, jobId: state.latest } });
    }
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
      bindingRevision: 4, state: previous, resultRevision: previous === "succeeded" ? 2 : null,
      error: previous === "failed" ? { code: "RATE_LIMITED", retryAfter: 90 } : null };
    if (path.endsWith("/remote-playlist-sync-jobs/replacement")) json = { jobId: "replacement", playlistId: "binding",
      bindingRevision: 7, state: state.state, resultRevision: state.state === "succeeded" ? 3 : null, error: null };
    if (path.endsWith("/me/favorites")) {
      state.favoriteReads++;
      json = { revision: state.added ? "2" : "1", nextCursor: null, items: state.added
        ? [{ track: song, musicTrack: musicTrack(song), forcedSourceTrackId: null, recordedAt: "2026-11-24T00:00:00Z" }] : [] };
    }
    if (path.endsWith("/playlists/local")) json = { playlistId: "local", name: "本地歌单", ruleRevision: 1, hideRevision: 1,
      snapshotRevision: state.added ? 2 : 1, stale: false, bindings: linked ? [{ kind: "remote", targetId: "binding" }] : [] };
    const snapshot = path.match(/\/playlists\/local\/snapshots\/(\d+)$/);
    if (snapshot) json = { playlistId: "local", revision: Number(snapshot[1]), items: snapshot[1] === "2"
      ? [{ entryId: "entry", source: { sourceTrackId: song.sourceTrackId, remoteSourceId: null }, provenance: [] }] : [],
      nextOffset: null, needsConfirmation: [] };
    if (path.endsWith("/source-tracks/" + song.sourceTrackId)) json = song;
    return route.fulfill({ json });
  });
  return { state, changed: () => control.event("activity.changed", { resources: ["playlistSync"] }) };
}

async function failedFavoriteLink(page: Page) {
  const fixture = await linkedPlaylist(page);
  await page.goto(`${origin}#/playlists`);
  const row = page.getByRole("region", { name: "网易云音乐 · 测试用户 的歌单", exact: true }).locator(".remote-row").filter({ hasText: "云端收藏" });
  await expect(row.getByRole("status")).toContainText("歌单同步触发请求上限，服务端会在冷却后自动重试。");
  await expect(row.getByRole("status")).toContainText("90 秒");
  return { row, ...fixture };
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
  state.added = true;
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
  state.added = true;
  changed();
  await expect(row.getByRole("status")).toContainText("已完成");
  await expect.poll(() => state.favoriteReads).toBe(before + 1);
  expect(state.submissions).toBe(0);
});

for (const target of ["favorites", "local"] as const) {
  test(`a successful linked playlist can sync new songs from the open ${target} page`, async ({ page }) => {
    const { state, changed } = await linkedPlaylist(page, { target, previous: "succeeded", previousJob: target === "favorites" });
    await page.goto(`${origin}#/${target === "favorites" ? "favorites" : "playlists/local"}`);
    const sync = page.getByRole("button", { name: "立即同步", exact: true });
    await expect(sync).toBeEnabled();
    const song = page.getByRole("button", { name: "播放 已同步曲目", exact: true });
    await expect(song).toHaveCount(0);
    // 同一帧内连续点击，覆盖按钮尚未重绘时的重复提交。
    await sync.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => state.submissions).toBe(1);
    state.state = "running";
    changed();
    await expect(page.getByRole("status").filter({ hasText: "同步中" })).toBeVisible();
    await expect(sync).toBeDisabled();
    state.state = "succeeded";
    state.added = true;
    changed();
    await expect(song).toBeVisible();
    await expect(sync).toBeEnabled();
    expect(state.submissions).toBe(1);
  });
}

test("a local playlist without remote bindings offers only local snapshot actions", async ({ page }) => {
  const { state } = await linkedPlaylist(page, { target: "local", linked: false });
  await page.goto(`${origin}#/playlists/local`);
  await expect(page.getByRole("button", { name: "更新歌单快照" })).toBeVisible();
  await expect(page.getByRole("button", { name: "立即同步", exact: true })).toHaveCount(0);
  expect(state.submissions).toBe(0);
});

test("the online playlist detail can start the first sync of an existing link", async ({ page }) => {
  const { state } = await linkedPlaylist(page, { legacy: true, previousJob: false });
  await page.goto(`${origin}#/discover/${instanceIds.netease}/210`);
  await expect(page.getByRole("heading", { name: "云端收藏", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新歌单", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "立即同步", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "排队中" })).toBeVisible();
  expect(state.imports).toBe(1);
  expect(state.submissions).toBe(0);
});

test("manual sync shows new NetEase tracks on the open online playlist detail", async ({ page }) => {
  const { state, changed } = await linkedPlaylist(page, { previous: "succeeded" });
  const url = `${origin}#/discover/${instanceIds.netease}/210`;
  await page.goto(url);
  const existing = page.getByRole("cell", { name: "原有歌曲", exact: true });
  const added = page.getByRole("cell", { name: "新加入的歌曲", exact: true });
  await expect(existing).toBeVisible();
  await expect(added).toHaveCount(0);
  await page.getByRole("button", { name: "立即同步", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "排队中" })).toBeVisible();
  state.state = "succeeded";
  state.added = true;
  changed();
  await expect(added).toBeVisible();
  await expect(existing).toBeVisible();
  await expect(page.locator(".detail-heading")).toContainText("2 首");
  await expect(page).toHaveURL(url);
  expect(state.submissions).toBe(1);
  expect(state.imports).toBe(0);
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
  const sync = (id: string) => row(id).getByRole("button", { name: "立即同步", exact: true });
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
