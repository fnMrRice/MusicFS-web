import { instanceIds, neteasePlugin } from "../fixtures/plugins";
import { musicTrack } from "../fixtures/music-catalog";
import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";

let server: PreviewServer;
const origin = "http://127.0.0.1:18143";
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18143, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const custom = {
  instanceId: instanceIds.custom, name: "Private online alias", platform: "never-seen-platform",
  plugin: { id: "example.radio", name: "搜索", localizedNames: { "zh-CN": "自定义节拍", "zh-Hant": "自訂節拍" }, features: ["music-source"] },
  availability: "available", capabilities: [{ name: "playlist.list", supported: true, reason: "Supported" }],
};
const local = {
  id: instanceIds.customFolder, name: "Private folder alias", availability: "available", capabilities: [],
  plugin: { id: "example.folder", name: "Folder library", localizedNames: { "zh-CN": "目录音乐", "zh-Hant": "目錄音樂" }, features: ["music-source"] },
};
const playlist = (externalId: string, title: string) => ({ externalId, title, sourceUrl: "", trackCount: 2 });

async function mock(page: Page, availability = "available", supported = true, mode: "nonempty" | "empty" | "failure" = "nonempty") {
  let signedIn = availability === "available";
  const requests: { path: string; method: string; cursor: string | null }[] = [];
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    requests.push({ path, method: request.method(), cursor: url.searchParams.get("cursor") });
    let json: unknown = { items: [], nextCursor: null, nextAfter: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "source-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "test-csrf", user: { id: "listener", role: "user" } };
    if (path.endsWith("/online-instances")) json = { items: [
      { ...custom, name: signedIn ? "Actual account listener" : custom.plugin.name,
        accountId: signedIn ? "real-account" : undefined, availability,
        capabilities: [{ name: "playlist.list", supported, reason: "Fixture" }] },
      { instanceId: instanceIds.qqmusic, name: "Private offline alias", platform: "qqmusic", availability: "offline", capabilities: [] },
    ] };
    if (path.endsWith("/provider-instances")) json = { items: [local,
      { ...local, id: custom.instanceId, name: "Duplicate alias", plugin: custom.plugin },
      { ...local, id: instanceIds.ffmpeg, name: "Decoder alias", plugin: { ...local.plugin, name: "Excluded decoder", features: ["decode"] } },
    ] };
    if (path.endsWith("/account/options")) json = { method: "qr", configured: true };
    if (path.endsWith("/account")) {
      if (request.method() === "POST") {
        signedIn = request.postDataJSON().action !== "logout";
        availability = signedIn ? "available" : "loginRequired";
      }
      json = signedIn ? { state: "signedIn", accountId: "real-account", displayName: "Actual account listener" } : { state: "signedOut" };
    }
    if (path.endsWith(`/online-instances/${instanceIds.custom}/playlists`) && mode === "failure")
      return route.fulfill({ status: 503, json: { error: { code: "SOURCE_UNAVAILABLE" } } });
    if (path.endsWith(`/online-instances/${instanceIds.custom}/playlists`)) json = {
      items: url.searchParams.get("cursor")
        ? [playlist("p1", "Morning mix"), playlist("p2", "Evening mix")]
        : [playlist("p1", "Morning mix")],
      nextCursor: url.searchParams.get("cursor") ? null : "opaque/next+page",
      consistency: "unversioned", observedAt: "2026-10-10T08:00:00Z",
    };
    if (path.endsWith(`/online-instances/${instanceIds.custom}/playlists`) && mode === "empty") json = {
      items: [], nextCursor: null, consistency: "unversioned", observedAt: "2026-10-10T08:00:00Z",
    };
    if (path.endsWith(`/online-instances/${instanceIds.custom}/playlists/p1`)) json = {
      playlist: playlist("p1", "Morning mix"), entries: [], complete: true, observedAt: "2026-10-10T08:00:00Z",
    };
    if (path.endsWith("/recommendations")) json = { historyDepth: 0, sources: [{ instanceId: custom.instanceId, name: "Hidden recommendation alias", items: [], stale: false, expiresAt: null, lastSuccessAt: null, error: null }] };
    return route.fulfill({ json });
  });
  return requests;
}

test("one music-source settings section uses arbitrary plugin translations and keeps aliases hidden", async ({ page }) => {
  const requests = await mock(page, "loginRequired");
  await page.goto(`${origin}/#/settings`);
  await expect(page.getByRole("heading", { name: "音乐源", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "音乐来源", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "音乐平台账号", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "自定义节拍", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "目录音乐", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "未知来源", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Excluded decoder" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "音乐源", exact: true }).locator("h4")).toHaveCount(3);
  await expect(page.locator(".settings-page").getByText(/Private|Duplicate|qq-public/)).toHaveCount(0);
  await page.getByRole("navigation", { name: "设置分类", exact: true }).getByRole("button", { name: "外观与语言", exact: true }).click();
  await page.locator(".language-select select").selectOption("zh-TW");
  await page.getByRole("navigation", { name: "設定分類", exact: true }).getByRole("button").first().click();
  await expect(page.getByRole("heading", { name: "自訂節拍", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "目錄音樂", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "設定分類", exact: true }).getByRole("button", { name: "外觀與語言", exact: true }).click();
  await page.locator(".language-select select").selectOption("en");
  await page.getByRole("navigation", { name: "Settings categories", exact: true }).getByRole("button", { name: "Music sources", exact: true }).click();
  await expect(page.getByRole("heading", { name: "搜索", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Folder library", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "登录搜索", exact: true }).click();
  await expect(page.getByText("Actual account listener", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "默认头像", exact: true }).first()).toBeVisible();
  const accountPage = page.locator(`aside a[href="#/sources/${instanceIds.custom}/playlists"]`);
  await expect(accountPage).toBeVisible();
  await expect(accountPage).toHaveAccessibleName(/搜索 · Actual account listener/);
  await page.getByRole("button", { name: "退出搜索账号", exact: true }).click();
  await expect(accountPage).toHaveCount(0);
  expect(requests.some((r) => r.path === `/api/v1/online-instances/${instanceIds.custom}/account` && r.method === "POST")).toBe(true);
  await page.goto(`${origin}/#/recommendations`);
  await expect(page.getByRole("heading", { name: "搜索", exact: true })).toBeVisible();
  await expect(page.getByText("Hidden recommendation alias")).toHaveCount(0);
});

test("recommendations show cover fallbacks and the playlist preview refreshes details and track pages", async ({ page }) => {
  await mock(page);
  const coverUrl = "https://p1.music.126.net/playlist-cover.png";
  const available = { ...playlist("p1", "Morning mix"), coverUrl };
  const unavailable = { ...playlist("p2", "Evening mix"), coverUrl: "https://p1.music.126.net/missing.png" };
  const empty = { ...playlist("p3", "Night mix"), coverUrl: null };
  await page.route(coverUrl, (route) => route.fulfill({ contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=", "base64") }));
  await page.route(unavailable.coverUrl, (route) => route.fulfill({ status: 404 }));
  await page.route("**/api/v1/recommendations?*", (route) => route.fulfill({ json: { historyDepth: 0, sources: [{
    instanceId: custom.instanceId, name: custom.name, stale: false, expiresAt: null, lastSuccessAt: null, error: null,
    items: [available, unavailable, empty].map((playlist, position) => ({ playlist, position, reason: "" })),
  }] } }));
  let observations = 0;
  const reads: (string | null)[] = [];
  const path = `**/api/v1/online-instances/${custom.instanceId}/playlists/p1`;
  await page.route(path, (route) => route.fulfill({ json: {
    playlist: { ...available, title: ++observations === 1 ? available.title : "Updated mix" },
    entries: [], complete: true, observedAt: "2026-10-10T08:00:00Z",
  } }));
  await page.route(`${path}/tracks?*`, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    reads.push(cursor);
    if (reads.length === 3) return route.fulfill({ status: 503, json: { error: { code: "TEMPORARY_FAILURE" } } });
    const position = cursor === null ? 0 : 1;
    const track = { externalId: String(position), artists: [], title: observations === 1 ? `Previous track ${position}` : "New track" };
    return route.fulfill({ json: { playlist: available, items: [{ position, externalId: track.externalId, track }],
      nextCursor: observations === 1 && cursor === null ? "previous-page" : null } });
  });

  await page.goto(`${origin}/#/recommendations`);
  const morning = page.locator("#page-scroll").getByRole("link", { name: /Morning mix/ });
  await expect.poll(() => morning.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(page.getByRole("link", { name: /Evening mix/ }).locator(".cover svg")).toBeVisible();
  await expect(page.getByRole("link", { name: /Night mix/ }).locator(".cover svg")).toBeVisible();
  await expect(page.getByText("平台推荐 · 需登录")).toHaveCount(0);
  await morning.click();
  await expect(page.getByRole("heading", { name: "Morning mix" })).toBeVisible();
  await expect.poll(() => page.locator(".detail-heading .cover img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(page.getByText("打开歌单不会自动导入；播放能力由各来源提供。")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Previous track 1" })).toBeVisible();
  await page.getByRole("button", { name: "刷新歌单", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Updated mix" })).toBeVisible();
  await page.getByRole("alert").getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("cell", { name: "New track" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Previous track/ })).toHaveCount(0);
  expect(observations).toBe(2);
  expect(reads).toEqual([null, "previous-page", null, null]);
});

test("recommendations load today's results, refresh explicitly, and select any of five saved results", async ({ page }) => {
  await mock(page);
  let latest = 1;
  const reads: string[] = [];
  await page.route("**/api/v1/recommendations?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    reads.push(query.toString());
    if (query.get("refresh") === "true") latest++;
    const offset = Number(query.get("history") ?? 0);
    const generation = latest - offset;
    return route.fulfill({ json: { historyDepth: Math.min(latest - 1, 5), sources: [{
      instanceId: custom.instanceId, name: custom.name, stale: false, expiresAt: null, lastSuccessAt: null, error: null,
      items: [{ playlist: playlist(String(generation), `Mix ${generation}`), position: 0, reason: "" }],
    }] } });
  });

  const mix = (generation: number) => page.locator(".music-card").getByText(`Mix ${generation}`, { exact: true });
  const machine = page.getByRole("button", { name: "时光机", exact: true });
  const popup = page.getByRole("dialog", { name: "时光机", exact: true });
  const history = (offset: number) => popup.getByRole("button", { name: `历史推荐（${offset}/5）`, exact: true });
  const refresh = page.getByRole("button", { name: "刷新推荐", exact: true });
  await page.goto(`${origin}/#/recommendations`);
  await expect(mix(1)).toBeVisible();
  await expect(machine).toBeDisabled();
  expect(reads.every(read => read === "refresh=false")).toBe(true);
  for (let next = 2; next <= 7; next++) {
    await refresh.click();
    await expect(mix(next)).toBeVisible();
  }
  const count = reads.length;
  const offsets = [5, 1, 4, 2, 3];
  for (const offset of offsets) {
    await machine.click();
    await expect(popup).toBeVisible();
    await expect(popup.getByRole("button", { name: /历史推荐/ })).toHaveCount(5);
    await history(offset).click();
    await expect(mix(7 - offset)).toBeVisible();
    await expect(popup).toBeHidden();
  }
  expect(reads.slice(count)).toEqual(offsets.map(offset => "history=" + offset));
  await machine.click();
  await popup.getByRole("button", { name: "最新推荐", exact: true }).click();
  await expect(mix(7)).toBeVisible();
  expect(reads).toHaveLength(count + 5);
  await machine.click();
  await history(1).click();
  await expect(mix(6)).toBeVisible();
  await refresh.click();
  await expect(mix(8)).toBeVisible();
  await expect(popup).toBeHidden();
  const beforeReopen = reads.length;
  await page.reload();
  await expect(mix(8)).toBeVisible();
  expect(reads.slice(beforeReopen)).toContain("refresh=false");
  expect(reads.slice(beforeReopen).every(read => read === "refresh=false")).toBe(true);
});

test("sidebar source playlists page reads and paginates the signed-in account without implicit import", async ({ page }) => {
  const requests = await mock(page);
  await page.goto(`${origin}/#/settings`);
  await page.locator(`aside a[href="#/sources/${instanceIds.custom}/playlists"]`).click();
  await expect(page.getByRole("heading", { name: "自定义节拍 · Actual account listener 的歌单", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Morning mix 2 首" })).toHaveCount(1);
  await page.getByRole("button", { name: "加载更多歌单" }).click();
  await expect(page.getByRole("link", { name: "Evening mix 2 首" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Morning mix 2 首" })).toHaveCount(1);
  expect(requests.filter((r) => r.path.endsWith(`${instanceIds.custom}/playlists`)).map((r) => r.cursor)).toEqual([null, "opaque/next+page"]);
  expect(requests.some((r) => r.path.endsWith("/recommendations"))).toBe(false);
  expect(requests.some((r) => r.path.endsWith("/remote-playlists"))).toBe(false);
  await page.getByRole("link", { name: "Morning mix 2 首" }).click();
  await expect(page.getByRole("heading", { name: "Morning mix", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "导入到歌单管理" })).toBeEnabled();
  expect(requests.some((r) => r.method === "POST")).toBe(false);
  await expect(page.getByRole("link", { name: "目录音乐 的歌单", exact: true })).toHaveCount(0);
  await page.goto(`${origin}/#/sources/${instanceIds.customFolder}/playlists`);
  await expect(page.getByText("此来源尚不支持读取账号歌单。", { exact: true })).toBeVisible();
  expect(requests.some((r) => r.path.includes(`online-instances/${instanceIds.customFolder}`))).toBe(false);
});

test("non-NetEase account playlists in management collapse together and keep their original list", async ({ page }) => {
  await mock(page);
  await page.goto(`${origin}/#/playlists`);
  const group = page.getByRole("region", { name: "自定义节拍 · Actual account listener 的歌单", exact: true });
  const toggle = group.getByRole("heading").getByRole("button");
  const mix = group.getByRole("link", { name: "自定义节拍-Morning mix 2 首", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(mix).toBeVisible();
  await group.getByRole("button", { name: "加载更多歌单" }).click();
  await expect(group.getByRole("link", { name: /Evening mix/ })).toBeVisible();
  await expect(group.getByRole("button", { name: /收藏的歌单/ })).toHaveCount(0);
  await toggle.click();
  await expect(mix).toBeHidden();
  await toggle.press("Enter");
  await expect(mix).toBeVisible();
});

test("multiple accounts on one plugin use usernames and keep UUID account actions isolated", async ({ page }) => {
  const accounts = new Map<string, { state: string; accountId?: string; displayName?: string }>([
    [instanceIds.netease, { state: "signedIn", accountId: "a", displayName: "Alice" }],
    [instanceIds.neteaseSecond, { state: "signedIn", accountId: "b", displayName: "Bob" }],
  ]);
  const actions: string[] = [];
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "account-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "test", user: { id: "admin", role: "admin" } };
    if (path.endsWith("/online-instances")) json = { items: [...accounts].map(([instanceId, account]) => ({
      instanceId, plugin: custom.plugin, platform: "custom", accountId: account.accountId,
      name: account.displayName ?? custom.plugin.name, availability: account.accountId ? "available" : "loginRequired", capabilities: [],
    })) };
    if (path.endsWith("/account/options")) json = { method: "qr", configured: true };
    if (path.endsWith("/account")) {
      const instanceId = path.split("/")[4];
      if (request.method() === "POST") {
        expect(request.postDataJSON().action).toBe("logout");
        actions.push(instanceId);
        accounts.set(instanceId, { state: "signedOut" });
      }
      json = accounts.get(instanceId);
    }
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/settings`);
  const alice = page.getByRole("region", { name: "自定义节拍 · Alice账号", exact: true });
  const bob = page.getByRole("region", { name: "自定义节拍 · Bob账号", exact: true });
  await expect(alice.getByRole("heading", { name: "自定义节拍 · Alice", exact: true })).toBeVisible();
  await expect(bob.getByRole("heading", { name: "自定义节拍 · Bob", exact: true })).toBeVisible();
  await expect(page.locator(".settings-page").getByText(/ab4dfbab|87d29d7b/)).toHaveCount(0);
  await alice.getByRole("button", { name: "退出自定义节拍账号", exact: true }).click();
  await expect(page.getByRole("heading", { name: "自定义节拍", exact: true })).toBeVisible();
  await expect(bob.getByRole("heading", { name: "自定义节拍 · Bob", exact: true })).toBeVisible();
  expect(actions).toEqual([instanceIds.netease]);
  expect(accounts.get(instanceIds.neteaseSecond)?.displayName).toBe("Bob");
});

test("source playlists show login, offline and unsupported states without fetching account lists", async ({ page }) => {
  for (const [availability, supported, text] of [
    ["loginRequired", true, "请先在设置中登录此音乐平台，再读取账号歌单。"],
    ["offline", true, "来源暂时离线，请稍后重试。"],
    ["available", false, "此来源尚不支持读取账号歌单。"],
  ] as const) {
    await page.unrouteAll();
    const requests = await mock(page, availability, supported);
    await page.goto(`${origin}/#/sources/${instanceIds.custom}/playlists`);
    await page.reload();
    await expect(page.getByText(text, { exact: false })).toBeVisible();
    expect(requests.some((r) => r.path.endsWith(`${instanceIds.custom}/playlists`))).toBe(false);
    await expect(page.getByRole("link", { name: "自定义节拍 的歌单", exact: true })).toHaveCount(0);
  }
});

test("empty and failed plugin playlist reads do not create sidebar categories", async ({ page }) => {
  for (const mode of ["empty", "failure"] as const) {
    await page.unrouteAll();
    const requests = await mock(page, "available", true, mode);
    await page.goto(`${origin}/#/settings`);
    await page.reload();
    await expect.poll(() => requests.some((r) => r.path.endsWith(`${instanceIds.custom}/playlists`))).toBe(true);
    await expect(page.getByRole("link", { name: "自定义节拍 的歌单", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "目录音乐 的歌单", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "未知来源 的歌单", exact: true })).toHaveCount(0);
  }
});

test("NetEase playlists appear in management and navigation, link once, accept track additions and unlink", async ({ page }) => {
  const instanceId = instanceIds.netease;
  const accountId = "listener";
  const source = { instanceId, accountId, name: "小林", platform: "netease", availability: "available", plugin: neteasePlugin,
    capabilities: ["playlist.list", "playlist.addTracks", "search.tracks"].map((name) => ({ name, supported: true, reason: "" })) };
  const second = { ...source, instanceId: instanceIds.neteaseSecond, name: "另一实例" };
  const own = { ...playlist("100", "通勤"), writable: true };
  const collected = { ...playlist("200", "睡前"), writable: false };
  const track = { externalId: "21", title: "序曲", artists: ["音乐人"], album: "", durationMs: 60000, sourceUrl: "" };
  const local = { playlistId: "local-1", name: "开车听", bindings: [], ruleRevision: 1, snapshotRevision: 0, hideRevision: 0, stale: true };
  let created = false, linked = false, additions = 0, linkAttempts = 0, referenceAttempts = 0;
  let targetPlaylistId = local.playlistId;
  const link = () => ({ platform: "netease", instanceId, accountId, externalId: own.externalId, playlistId: targetPlaylistId, pendingCount: additions, jobId: "catalog-import" });
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let json: unknown = { items: [], nextAfter: null, nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "playlist-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "csrf", user: { id: "user", role: "user" } };
    if (path.endsWith("/online-instances")) json = { items: [source, second] };
    if ([instanceId, second.instanceId].some((id) => path.endsWith(`/online-instances/${id}/playlists`))) json = {
      items: [own, collected], nextCursor: null, consistency: "unversioned", observedAt: "2026-11-19T00:00:00Z",
    };
    if (path.endsWith(`/playlists/${own.externalId}`)) json = { playlist: own, complete: true, observedAt: "", entries: [{ position: 0, externalTrackId: track.externalId }] };
    if (path.endsWith(`/playlists/${own.externalId}/tracks`)) json = { playlist: own, items: [{ position: 0, track, externalId: track.externalId, errorCode: null }], nextCursor: null, complete: true };
    if (path.endsWith("/search")) json = { tracks: [track], nextCursor: null, truncated: false };
    if (path === "/api/v1/playlists") {
      if (req.method() === "POST") {
        expect(req.postDataJSON()).toEqual({ name: local.name, bindings: [] });
        created = true;
        json = local;
      } else json = { items: created ? [local] : [], nextAfter: null };
    }
    if (path.endsWith(`/playlists/${local.playlistId}`)) {
      if (req.method() === "PUT") {
        expect(req.postDataJSON().bindings.at(-1)).toEqual({ kind: "local", entries: [{ source: { remoteSourceId: "ref-21", sourceTrackId: null } }] });
        expect(linked).toBe(true);
        additions++;
      }
      json = local;
    }
    if (path.endsWith("/playlist-track-sources")) {
      expect(req.postDataJSON()).toEqual({ accountId, externalIds: [track.externalId] });
      if (++referenceAttempts === 1) return route.fulfill({ status: 429, json: { error: { code: "RATE_LIMITED", retryAfter: 1 } } });
      json = { items: [{ remoteSourceId: "ref-21" }] };
    }
    if (path.endsWith("/playlist-links")) json = { items: linked ? [link()] : [] };
    if (path.endsWith("/remote-playlist-sync-jobs/catalog-import")) json = { jobId: "catalog-import", state: "succeeded", resultRevision: 1, error: null };
    if (path.endsWith("/me/favorites")) {
      const sourceTrack = { ...track, sourceTrackId: "source-21", providerInstanceId: instanceId, displayName: track.title,
        availability: "available", assetId: "asset-21", container: null, codec: null, bitrateBps: null,
        downloaded: true, downloadVersions: [["exhigh", "mp3", "audio/mpeg"], ["lossless", "flac", "audio/flac"]].map(([quality, codec, mime]) => ({
          versionId: quality, quality, mime, codec, container: codec, sizeBytes: 2097152, downloadedAt: "2026-11-20T12:00:00Z",
        })) };
      json = { items: linked && targetPlaylistId === "favorites" ? [{ musicTrack: musicTrack(sourceTrack), track: sourceTrack,
        recordedAt: "2026-11-20T12:00:00Z", forcedSourceTrackId: null }] : [], nextCursor: null, revision: linked ? "2" : "1" };
    }
    if (path.endsWith(`/playlists/${own.externalId}/link`)) {
      expect(path).toContain(instanceId);
      expect(req.postDataJSON()).toEqual({ accountId, playlistId: targetPlaylistId });
      if (++linkAttempts === 1) return route.fulfill({ status: 429, json: { error: { code: "RATE_LIMITED", retryAfter: 1 } } });
      linked = req.method() === "PUT";
      if (!linked) return route.fulfill({ status: 204 });
      json = link();
    }
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/playlists`);
  const group = page.getByRole("region", { name: "网易云音乐 · 小林 的歌单" });
  const mirror = page.getByRole("region", { name: "网易云音乐 · 另一实例 的歌单" });
  const sidebar = page.getByRole("complementary", { name: "侧栏" });
  const sidebarLink = sidebar.locator(`a[href="#/discover/${instanceId}/100"]`);
  await expect(sidebarLink).toHaveAccessibleName("网易云音乐-通勤");
  await expect(sidebarLink).toHaveText(own.title);
  const sidebarSaved = sidebar.getByRole("button", { name: /收藏的歌单/ });
  const sidebarCollected = sidebar.getByRole("link", { name: "网易云音乐-睡前", exact: true });
  await expect(sidebarCollected).toHaveCount(0);
  await expect(sidebarSaved).toHaveCount(2);
  await sidebarSaved.first().click();
  await expect(sidebarCollected).toHaveText(collected.title);
  const saved = group.getByRole("button", { name: /收藏的歌单/ });
  await expect(saved).toHaveAttribute("aria-expanded", "false");
  await saved.click();
  for (const playlist of [own, collected]) {
    const entry = group.getByRole("link", { name: playlist.title + " 2 首", exact: true });
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute("href", `#/discover/${instanceId}/${playlist.externalId}`);
  }
  await expect(group.getByText("只读", { exact: true })).toHaveCount(0);
  await expect(group.getByRole("button", { name: "关联本地歌单" })).toHaveCount(1);
  await group.getByRole("button", { name: "关联本地歌单" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("歌单名称").fill(local.name);
  await dialog.getByRole("button", { name: "关联本地歌单" }).click();
  const localTarget = group.getByRole("link", { name: "已关联：开车听", exact: true });
  await expect(localTarget).toHaveAttribute("href", `#/playlists/${local.playlistId}`);
  await expect(mirror.getByRole("link", { name: "已关联：开车听" })).toBeVisible();
  await expect(group.getByRole("button", { name: "关联本地歌单", exact: true })).toHaveCount(0);
  await sidebarLink.click();
  const add = page.getByRole("button", { name: "将 序曲 添加到歌单" });
  async function saveTrack() {
    await add.click();
    await dialog.getByLabel("目标歌单").selectOption(local.playlistId);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("曲目已保存");
    await dialog.getByRole("button", { name: "完成" }).click();
  }
  await saveTrack();
  await page.goto(`${origin}/#/search?q=序曲&source=${instanceId}`);
  await saveTrack();
  await page.goto(`${origin}/#/playlists`);
  await expect(group.getByText("2 首待同步", { exact: false })).toBeVisible();
  const unlink = group.getByRole("button", { name: "解除关联", exact: true });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await localTarget.scrollIntoViewIfNeeded();
    const text = await localTarget.evaluate(node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().toJSON() as { x: number; right: number; top: number; bottom: number };
    });
    const button = await unlink.boundingBox();
    if (!button) throw new Error("Unlink button has no visible bounds");
    expect(text.x).toBeGreaterThanOrEqual(0);
    expect(button.x + button.width).toBeLessThanOrEqual(width + 1);
    const gap = button.x - text.right;
    expect(gap).toBeGreaterThanOrEqual(-1);
    expect(gap).toBeLessThanOrEqual(20);
    const overlap = Math.min(text.bottom, button.y + button.height) - Math.max(text.top, button.y);
    expect(overlap).toBeGreaterThan(Math.min(text.bottom - text.top, button.height) / 2);
  }
  await localTarget.click();
  await expect(page).toHaveURL(`${origin}/#/playlists/${local.playlistId}`);
  await page.goBack();
  await expect(unlink).toBeVisible();
  await mirror.getByRole("button", { name: "解除关联" }).click();
  await dialog.getByRole("button", { name: "解除关联" }).click();
  await expect(group.getByRole("button", { name: "关联本地歌单" })).toBeEnabled();
  expect(linked).toBe(false);
  targetPlaylistId = "favorites";
  await group.getByRole("button", { name: "关联本地歌单" }).click();
  await dialog.getByLabel("本地歌单").selectOption({ label: "我的收藏" });
  await dialog.getByRole("button", { name: "关联本地歌单" }).click();
  const favoritesLink = group.getByRole("link", { name: "已关联：我的收藏" });
  await expect(favoritesLink).toHaveAttribute("href", "#/favorites");
  await expect(group.getByRole("status")).toContainText("已完成");
  await favoritesLink.click();
  await expect(page.getByRole("button", { name: "播放 序曲", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "展开 序曲 的来源版本", exact: true }).click();
  const downloads = page.getByLabel("来源版本", { exact: true }).locator(".source-downloads");
  await downloads.getByText("已下载 · 2 个版本").click();
  await expect(downloads.locator("li")).toHaveCount(2);
  await expect(downloads.getByText(/无损 · FLAC/)).toBeVisible();
  await page.goBack();
  await group.getByRole("button", { name: "解除关联" }).click();
  await expect(dialog.getByText(/解除与「我的收藏」的关联/)).toBeVisible();
  await dialog.getByRole("button", { name: "解除关联" }).click();
  await expect(favoritesLink).toHaveCount(0);
  expect(linked).toBe(false);
});
