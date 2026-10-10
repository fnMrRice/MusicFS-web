import { test, expect, type Page } from "@playwright/test";
import { startDirectoryServer, type DirectoryTestServer } from "./directory-server";

let server: DirectoryTestServer;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await startDirectoryServer();
});
test.afterAll(async () => { await server?.stop(); });

type Account = { state: string; [key: string]: unknown };
type AccountAction = { action: string; loginId?: string };
const avatarUrl = "https://p1.music.126.net/fixture-avatar.png";
const signedOutMessage = "尚未登录网易云音乐，登录后可使用此音乐来源。";
const listener: Account = { state: "signedIn", accountId: "fixture", displayName: "测试听众", avatarUrl };
const waiting = (loginId = "challenge"): Account => ({
  state: "waiting", method: "qr", loginId,
  qrUrl: `https://music.163.com/login?codekey=${loginId}`, pollAfterSeconds: 3,
  expiresAt: new Date(Date.now() + 180000).toISOString(),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function mockAccounts(
  page: Page,
  onAction: (body: AccountAction) => Promise<Account | undefined> | Account | undefined = () => undefined,
  initial: Account = { state: "signedOut" },
) {
  let state = initial;
  let csrfSeen = false;
  let searches = 0;
  const actions: AccountAction[] = [];
  const completed: AccountAction[] = [];
  await page.route("**/api/v1/**", async (route) => {
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
        const body = request.postDataJSON() as AccountAction;
        actions.push(body);
        const reply = await onAction(body);
        if (reply) {
          await route.fulfill({ json: reply });
          completed.push(body);
          return;
        }
        if (body.action === "begin") state = waiting();
        if (body.action === "poll") state = listener;
        if (body.action === "cancel" || body.action === "logout") state = { state: "signedOut" };
      }
      json = state;
    }
    return route.fulfill({ json });
  });
  return { actions, completed, get csrfSeen() { return csrfSeen; }, get searches() { return searches; } };
}

test("platform login opens a loading dialog, renders QR pixels and account identity, and logs out only the platform", async ({ page }) => {
  const begin = deferred<Account | undefined>();
  const mock = await mockAccounts(page, ({ action }) => action === "begin" ? begin.promise : undefined);
  await page.route(avatarUrl, (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=", "base64"),
  }));
  await page.goto(`${server.origin}/#/search?q=sample`);
  await expect(page.getByText("登录此音乐平台，再使用在线搜索。", { exact: false })).toBeVisible();
  expect(mock.searches).toBe(0);
  await page.goto(`${server.origin}/#/settings`);
  const heading = page.getByRole("heading", { name: "网易云音乐", exact: true });
  const login = page.getByRole("button", { name: "登录网易云音乐", exact: true });
  await expect(page.getByText("测试来源", { exact: false })).toHaveCount(0);
  await expect(page.getByText(signedOutMessage, { exact: true })).toBeVisible();
  await expect(login).toHaveText("登录");
  for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const titleBounds = await heading.boundingBox();
    const buttonBounds = await login.boundingBox();
    expect(titleBounds).not.toBeNull();
    expect(buttonBounds).not.toBeNull();
    expect(buttonBounds!.x).toBeGreaterThanOrEqual(titleBounds!.x + titleBounds!.width);
    expect(Math.abs(buttonBounds!.y + buttonBounds!.height / 2 - titleBounds!.y - titleBounds!.height / 2)).toBeLessThan(4);
    expect(buttonBounds!.x + buttonBounds!.width).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  await login.click();
  const dialog = page.getByRole("dialog", { name: "登录网易云音乐", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("正在加载二维码");
  await expect(dialog.getByAltText("网易云音乐登录二维码")).not.toBeVisible();
  await expect.poll(() => mock.actions.map(({ action }) => action)).toEqual(["begin"]);
  await page.screenshot({ path: "test-results/account-login-loading.png" });
  begin.resolve(undefined);
  const qr = dialog.getByAltText("网易云音乐登录二维码");
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute("src", /^data:image\/png;base64,/);
  // A visible img with a src still passes when the server CSP blocks its pixels.
  await expect.poll(() => qr.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(dialog.getByText("正在加载二维码", { exact: true })).not.toBeVisible();
  await page.screenshot({ path: "test-results/account-login-qr.png" });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("测试听众", { exact: true })).toBeVisible();
  await expect(page.getByText("已登录", { exact: true })).toBeVisible();
  const avatar = page.getByAltText("测试听众的头像", { exact: true });
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/account-profile.png" });
  expect(mock.csrfSeen).toBe(true);
  await page.goto(`${server.origin}/#/search?q=sample`);
  await expect.poll(() => mock.searches).toBe(1);
  await page.goto(`${server.origin}/#/settings`);
  await page.getByRole("button", { name: "退出网易云音乐账号", exact: true }).click();
  await expect(login).toBeEnabled();
  await expect(page.getByText(signedOutMessage, { exact: true })).toBeVisible();
  await expect(avatar).toHaveCount(0);
  await expect(page.getByText("测试听众", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/settings$/);
  await page.goto(`${server.origin}/#/search?q=sample`);
  await expect(page.getByText("登录此音乐平台，再使用在线搜索。", { exact: false })).toBeVisible();
  expect(mock.searches).toBe(1);
});

test("closing during begin keeps its late challenge out of a reopened login dialog", async ({ page }) => {
  const firstBegin = deferred<Account>();
  let begins = 0;
  const mock = await mockAccounts(page, ({ action }) => {
    if (action === "begin") return ++begins === 1 ? firstBegin.promise : waiting("current-challenge");
    if (action === "poll") return waiting("current-challenge");
  });
  await page.goto(`${server.origin}/#/settings`);
  const login = page.getByRole("button", { name: "登录网易云音乐", exact: true });
  const dialog = page.getByRole("dialog", { name: "登录网易云音乐", exact: true });
  await login.click();
  await expect(dialog.getByRole("status")).toHaveText("正在加载二维码");
  await expect.poll(() => begins).toBe(1);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(signedOutMessage, { exact: true })).toBeVisible();
  await login.click();
  await expect(dialog.getByRole("status")).toHaveText("正在加载二维码");
  firstBegin.resolve(waiting("obsolete-challenge"));
  await expect.poll(() => mock.actions.some(({ action, loginId }) => action === "cancel" && loginId === "obsolete-challenge")).toBe(true);
  const qr = dialog.getByAltText("网易云音乐登录二维码");
  await expect(qr).toBeVisible();
  const currentQR = await qr.getAttribute("src");
  await expect.poll(() => mock.actions.some(({ action }) => action === "poll")).toBe(true);
  await expect(qr).toHaveAttribute("src", currentQR!);
  expect(mock.actions.filter(({ action }) => action === "poll").every(({ loginId }) => loginId === "current-challenge")).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("Escape cancels an in-flight poll and ignores its late successful result", async ({ page }) => {
  const poll = deferred<Account>();
  const mock = await mockAccounts(page, ({ action }) => action === "poll" ? poll.promise : undefined);
  await page.goto(`${server.origin}/#/settings`);
  const login = page.getByRole("button", { name: "登录网易云音乐", exact: true });
  const dialog = page.getByRole("dialog", { name: "登录网易云音乐", exact: true });
  await login.click();
  await expect(dialog.getByAltText("网易云音乐登录二维码")).toBeVisible();
  await expect.poll(() => mock.actions.some(({ action }) => action === "poll")).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => mock.actions.some(({ action }) => action === "cancel")).toBe(true);
  poll.resolve(listener);
  await expect.poll(() => mock.completed.some(({ action }) => action === "poll")).toBe(true);
  // Let the browser process the delayed response before checking account state.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(login).toBeEnabled();
  await expect(page.getByText(signedOutMessage, { exact: true })).toBeVisible();
  await expect(page.getByText("测试听众", { exact: true })).toHaveCount(0);
  await expect(page.getByAltText("测试听众的头像", { exact: true })).toHaveCount(0);
});

test("a failed remote avatar retains the signed-in name and shows a default avatar", async ({ page }) => {
  await mockAccounts(page, undefined, listener);
  await page.route(avatarUrl, (route) => route.fulfill({ status: 404, body: "Avatar unavailable" }));
  await page.goto(`${server.origin}/#/settings`);
  await expect(page.getByText("测试听众", { exact: true })).toBeVisible();
  await expect(page.getByText("已登录", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "默认头像", exact: true })).toBeVisible();
  await expect(page.getByAltText("测试听众的头像", { exact: true })).toHaveCount(0);
});
