import { test, expect } from "@playwright/test";
import { startDirectoryServer, type DirectoryTestServer } from "./directory-server";

let server: DirectoryTestServer;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await startDirectoryServer();
});
test.afterAll(async () => { await server?.stop(); });
test("platform QR login, local QR rendering, and platform-only logout", async ({ page }) => {
  const { origin } = server;
  let state: Record<string, unknown> = { state: "signedOut" };
  let csrfSeen = false;
  let searches = 0;
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "account-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "test-csrf", user: { id: "admin", role: "admin" } };
    if (path.endsWith("/online-instances")) json = { items: [{ instanceId: "net", name: "测试来源", platform: "netease", plugin: { features: ["music-source"], id: "musicfs.netease", name: "NetEase Cloud Music", localizedNames: { "zh-CN": "网易云音乐" } }, availability: state.state === "signedIn" ? "available" : "loginRequired", capabilities: [{ name: "search.tracks", supported: true, reason: "" }] }] };
    if (path.endsWith("/search")) { searches++; json = { tracks: [], nextCursor: null, truncated: false }; }
    if (path.endsWith("/account/options")) json = { method: "qr", configured: true, validation: "liveAccountPending" };
    if (path.endsWith("/account")) {
      if (request.method() === "POST") {
        csrfSeen = request.headers()["x-csrf-token"] === "test-csrf";
        const body = request.postDataJSON() as { action: string };
        if (body.action === "begin") state = { state: "waiting", method: "qr", loginId: "challenge", qrUrl: "https://music.163.com/login?codekey=synthetic", pollAfterSeconds: 3, expiresAt: new Date(Date.now() + 180000).toISOString() };
        if (body.action === "poll") state = { state: "signedIn", accountId: "fixture", displayName: "测试听众" };
        if (body.action === "cancel" || body.action === "logout") state = { state: "signedOut" };
      }
      json = state;
    }
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/search?q=sample`);
  await expect(page.getByText("登录此音乐平台，再使用在线搜索。", { exact: false })).toBeVisible();
  expect(searches).toBe(0);
  await page.goto(`${origin}/#/settings`);
  await expect(page.getByRole("heading", { name: "网易云音乐", exact: true })).toBeVisible();
  await expect(page.getByText("测试来源", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "登录网易云音乐", exact: true }).click();
  const qr = page.getByAltText("网易云音乐登录二维码");
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute("src", /^data:image\/png;base64,/);
  // A visible img with a src still passes when the server CSP blocks its pixels.
  await expect.poll(() => qr.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("已登录 · 测试听众")).toBeVisible();
  expect(csrfSeen).toBe(true);
  await page.goto(`${origin}/#/search?q=sample`);
  await expect.poll(() => searches).toBe(1);
  await page.goto(`${origin}/#/settings`);
  await page.getByRole("button", { name: "退出网易云音乐账号", exact: true }).click();
  await expect(page.getByRole("button", { name: "登录网易云音乐", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goto(`${origin}/#/search?q=sample`);
  await expect(page.getByText("登录此音乐平台，再使用在线搜索。", { exact: false })).toBeVisible();
  expect(searches).toBe(1);
});
