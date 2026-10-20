import { instanceIds } from "../fixtures/plugins";
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
    if (path.endsWith("/recommendations")) json = { sources: [{ instanceId: custom.instanceId, name: "Hidden recommendation alias", items: [], stale: false, expiresAt: null, lastSuccessAt: null, error: null }] };
    return route.fulfill({ json });
  });
  return requests;
}

test("one music-source settings section uses arbitrary plugin translations and keeps aliases hidden", async ({ page }) => {
  const requests = await mock(page, "loginRequired");
  await page.goto(`${origin}/#/settings`);
  await expect(page.getByRole("heading", { name: "音乐来源", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "音乐平台账号", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "自定义节拍", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "目录音乐", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "未知来源", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Excluded decoder" })).toHaveCount(0);
  await expect(page.locator("h4")).toHaveCount(3);
  await expect(page.locator(".settings-page").getByText(/Private|Duplicate|qq-public/)).toHaveCount(0);
  await page.getByRole("tab", { name: "其他配置", exact: true }).click();
  await page.locator(".language-select select").selectOption("zh-TW");
  await page.getByRole("tab").first().click();
  await expect(page.getByRole("heading", { name: "自訂節拍", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "目錄音樂", exact: true })).toBeVisible();
  await page.getByRole("tab").last().click();
  await page.locator(".language-select select").selectOption("en");
  await page.getByRole("tab", { name: "Music sources", exact: true }).click();
  await expect(page.getByRole("heading", { name: "搜索", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Folder library", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "登录搜索", exact: true }).click();
  await expect(page.getByText("Actual account listener", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "默认头像", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "搜索 · Actual account listener playlists", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出搜索账号", exact: true }).click();
  await expect(page.getByRole("link", { name: "搜索 · Actual account listener playlists", exact: true })).toHaveCount(0);
  expect(requests.some((r) => r.path === `/api/v1/online-instances/${instanceIds.custom}/account` && r.method === "POST")).toBe(true);
  await page.goto(`${origin}/#/recommendations`);
  await expect(page.getByRole("heading", { name: "搜索", exact: true })).toBeVisible();
  await expect(page.getByText("Hidden recommendation alias")).toHaveCount(0);
});

test("sidebar source playlists page reads and paginates the signed-in account without implicit import", async ({ page }) => {
  const requests = await mock(page);
  await page.goto(`${origin}/#/settings`);
  await page.getByRole("link", { name: "自定义节拍 · Actual account listener 的歌单", exact: true }).click();
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
