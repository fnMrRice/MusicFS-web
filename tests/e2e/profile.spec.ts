import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";

let server: PreviewServer;
const origin = "http://127.0.0.1:18172";
const accountId = "profile-listener";

test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 18172, strictPort: true } });
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server?.httpServer.close(() => resolve()));
});

async function mock(page: Page, options: { nickname?: string | null; legacy?: boolean; failSaves?: number } = {}) {
  const state = {
    nickname: options.nickname ?? null,
    userId: accountId,
    authenticated: true,
    profileReads: 0,
    failSaves: options.failSaves ?? 0,
    saves: [] as { nickname: string | null }[],
    logoutCalls: 0,
  };
  const user = () => ({ id: state.userId, role: "user" });
  const profile = () => ({ user: user(), nickname: state.nickname, avatar: null, avatarUploadSupported: false });
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith("/health/ready")) return route.fulfill({ json: {
      product: "MusicFS", ready: true, apiVersion: "1", instanceId: "profile-test",
    } });
    if (path.endsWith("/auth/session")) {
      if (method === "DELETE") {
        state.authenticated = false;
        state.logoutCalls += 1;
        return route.fulfill({ status: 204 });
      }
      if (method === "POST") state.authenticated = true;
      return state.authenticated
        ? route.fulfill({ json: { csrfToken: "profile-csrf", user: user() } })
        : route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED" } } });
    }
    if (path.endsWith("/me/profile")) {
      if (method === "GET") state.profileReads += 1;
      if (options.legacy) return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
      if (method === "PUT") {
        state.saves.push(route.request().postDataJSON() as { nickname: string | null });
        if (state.failSaves > 0) {
          state.failSaves -= 1;
          return route.fulfill({ status: 503, json: { error: {
            code: "SERVICE_UNAVAILABLE", requestId: "profile-save-failed",
          } } });
        }
        state.nickname = state.saves.at(-1)!.nickname;
      }
      return route.fulfill({ json: profile() });
    }
    return route.fulfill({ json: { items: [], nextCursor: null, nextAfter: null, libraryRevision: "1" } });
  });
  return state;
}

async function openAccount(page: Page) {
  await page.getByRole("button", { name: "账号菜单", exact: true }).hover();
  const account = page.getByRole("region", { name: "账号操作", exact: true });
  await expect(account).toBeVisible();
  return account;
}

async function editNickname(page: Page) {
  const account = await openAccount(page);
  await account.getByRole("button", { name: "修改昵称", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "修改昵称", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("account reads the server nickname while retaining its account ID", async ({ page }, info) => {
  const state = await mock(page, { nickname: "夜间听众" });
  await page.goto(`${origin}/#/library`);
  const account = await openAccount(page);
  await expect(account.getByText("夜间听众", { exact: true })).toBeVisible();
  await expect(account).toContainText(accountId);
  await expect.poll(() => state.profileReads).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "账号菜单", exact: true })).toHaveText("");
  await page.screenshot({ path: info.outputPath("account-nickname.png") });
  const dialog = await editNickname(page);
  await expect(dialog.getByLabel("昵称", { exact: true })).toHaveValue("夜间听众");
  await page.screenshot({ path: info.outputPath("account-nickname-editor.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "账号菜单", exact: true })).toBeFocused();
});

test("saving trims the nickname, updates the card immediately and survives refresh", async ({ page }) => {
  const state = await mock(page, { nickname: "旧昵称" });
  await page.goto(`${origin}/#/library`);
  const dialog = await editNickname(page);
  await expect(dialog.getByLabel("昵称", { exact: true })).toHaveValue("旧昵称");
  await dialog.getByLabel("昵称", { exact: true }).fill("  新昵称 🎵  ");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.saves).toEqual([{ nickname: "新昵称 🎵" }]);
  await expect(page.getByRole("button", { name: "账号菜单", exact: true })).toBeFocused();
  await expect((await openAccount(page)).getByText("新昵称 🎵", { exact: true })).toBeVisible();
  const reads = state.profileReads;
  await page.reload();
  await expect((await openAccount(page)).getByText("新昵称 🎵", { exact: true })).toBeVisible();
  await expect.poll(() => state.profileReads).toBeGreaterThan(reads);
});

test("clearing a nickname sends null and restores the account ID after refresh", async ({ page }) => {
  const state = await mock(page, { nickname: "即将清空" });
  await page.goto(`${origin}/#/library`);
  const dialog = await editNickname(page);
  await dialog.getByLabel("昵称", { exact: true }).fill("   ");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.saves).toEqual([{ nickname: null }]);
  const account = await openAccount(page);
  await expect(account).toContainText(accountId);
  await expect(account.getByText("即将清空", { exact: true })).toHaveCount(0);
  await page.reload();
  await openAccount(page);
  await expect(account.getByText("即将清空", { exact: true })).toHaveCount(0);
  const reopened = await editNickname(page);
  await expect(reopened.getByLabel("昵称", { exact: true })).toHaveValue("");
});

test("a failed save keeps the draft and previous nickname until a successful retry", async ({ page }) => {
  const state = await mock(page, { nickname: "原昵称", failSaves: 1 });
  await page.goto(`${origin}/#/library`);
  const dialog = await editNickname(page);
  await dialog.getByLabel("昵称", { exact: true }).fill("保留的草稿");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("昵称", { exact: true })).toHaveValue("保留的草稿");
  expect(state.nickname).toBe("原昵称");
  expect(state.saves).toEqual([{ nickname: "保留的草稿" }]);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("button", { name: "账号菜单", exact: true })).toBeFocused();
  await expect((await openAccount(page)).getByText("原昵称", { exact: true })).toBeVisible();
  await expect(page.getByText("保留的草稿", { exact: true })).toHaveCount(0);
  const retry = await editNickname(page);
  await retry.getByLabel("昵称", { exact: true }).fill("重试成功");
  await retry.getByRole("button", { name: "保存", exact: true }).click();
  await expect(retry).toHaveCount(0);
  await expect((await openAccount(page)).getByText("重试成功", { exact: true })).toBeVisible();
  expect(state.saves).toEqual([{ nickname: "保留的草稿" }, { nickname: "重试成功" }]);
});

test("nickname length counts Unicode code points and accepts exactly 80 emoji", async ({ page }, info) => {
  const state = await mock(page);
  await page.goto(`${origin}/#/library`);
  const dialog = await editNickname(page);
  const input = dialog.getByLabel("昵称", { exact: true });
  await input.fill("🎵".repeat(81));
  await expect(input).toHaveValue("🎵".repeat(81));
  const save = dialog.getByRole("button", { name: "保存", exact: true });
  if (await save.isEnabled()) await save.click();
  await expect(dialog).toBeVisible();
  expect(state.saves).toEqual([]);
  await input.fill("🎵".repeat(80));
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(state.saves).toEqual([{ nickname: "🎵".repeat(80) }]);
  await expect((await openAccount(page)).getByText("🎵".repeat(80), { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(await openAccount(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("account-long-nickname-mobile.png") });
});

test("a legacy server without profiles still permits opening the account and signing out", async ({ page }) => {
  const state = await mock(page, { legacy: true });
  await page.goto(`${origin}/#/library`);
  const account = await openAccount(page);
  await expect(account).toContainText(accountId);
  await expect.poll(() => state.profileReads).toBeGreaterThan(0);
  await account.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator(".login-page")).toBeVisible();
  expect(state.logoutCalls).toBe(1);
  await expect(page.getByRole("region", { name: "账号操作", exact: true })).toHaveCount(0);
});

test("signing in as another account does not retain the previous nickname", async ({ page }) => {
  const state = await mock(page, { nickname: "上一位听众" });
  await page.goto(`${origin}/#/library`);
  const account = await openAccount(page);
  await expect(account.getByText("上一位听众", { exact: true })).toBeVisible();
  await account.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator(".login-page")).toBeVisible();
  state.userId = "second-listener";
  state.nickname = null;
  await page.getByLabel("管理员登录令牌", { exact: true }).fill("second-account-fixture");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const nextAccount = await openAccount(page);
  await expect(nextAccount).toContainText("second-listener");
  await expect(nextAccount.getByText("上一位听众", { exact: true })).toHaveCount(0);
});
