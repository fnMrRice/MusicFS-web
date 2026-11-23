import { expect, test, type Locator, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { instanceIds, neteasePlugin } from "../fixtures/plugins";

const origin = "http://127.0.0.1:18290";
let server: PreviewServer;
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18290, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const alpha = instanceIds.netease, beta = instanceIds.neteaseSecond;
const songList = (scope: Locator, account: string, external: string) => scope.locator(`a[href="#/discover/${account}/${external}"]`);

async function controlled(button: Locator) {
  const id = await button.getAttribute("aria-controls");
  expect(id).toBeTruthy();
  return button.page().locator(`[id="${id}"]`);
}

async function mockPlaylists(page: Page) {
  const state = { user: "listener", alphaAccount: "Alpha", continuations: [] as string[] };
  const instance = (instanceId: string, name: string) => ({
    instanceId, name, accountId: instanceId === alpha ? state.alphaAccount : name, accountRevision: "1",
    plugin: neteasePlugin, platform: "netease", availability: "available",
    capabilities: ["playlist.list", "playlist.addTracks"].map(name => ({ name, supported: true, reason: "" })),
  });
  const mix = (externalId: string, writable?: boolean) => ({ externalId, title: `Mix ${externalId}`, writable,
    sourceUrl: "", trackCount: 1, coverUrl: null });
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    let json: unknown = { items: [], nextAfter: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "fixture" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: state.user, role: "user" } };
    if (path.endsWith("/online-instances")) json = { items: [instance(alpha, "Alpha"), instance(beta, "Beta")] };
    const list = path.match(/^\/api\/v1\/online-instances\/([^/]+)\/playlists$/);
    if (list) {
      const cursor = url.searchParams.get("cursor");
      if (cursor) state.continuations.push(list[1] + ":" + cursor);
      json = { items: cursor ? [mix("3"), mix("4", true)] : [mix("1", true), mix("2", false)],
        nextCursor: list[1] === alpha && !cursor ? "next" : null, consistency: "unversioned", observedAt: "2026-11-23T00:00:00Z" };
    }
    const detail = path.match(/\/playlists\/(\d+)(\/tracks)?$/);
    if (detail) json = detail[2] ? { playlist: mix(detail[1]), items: [], nextCursor: null } :
      { playlist: mix(detail[1]), entries: [], complete: true, observedAt: "2026-11-23T00:00:00Z" };
    return route.fulfill({ json });
  });
  return state;
}

test("account folders and their saved NetEase playlists fold independently across pages", async ({ page }) => {
  const state = await mockPlaylists(page);
  await page.goto(`${origin}/#/playlists`);
  const sidebar = page.getByRole("complementary", { name: "侧栏" });
  const content = page.locator("#page-scroll");
  const folder = (label: string) => sidebar.locator("button[aria-expanded]").filter({ hasText: label });
  const a = folder("Alpha"), b = folder("Beta");
  await expect(a).toHaveAttribute("aria-expanded", "true");
  await expect(b).toHaveAttribute("aria-expanded", "true");
  const areaA = await controlled(a), areaB = await controlled(b);
  const savedA = areaA.getByRole("button", { name: /收藏的歌单/ });
  const savedB = areaB.getByRole("button", { name: /收藏的歌单/ });
  await expect(savedA).toHaveAttribute("aria-expanded", "false");
  await expect(savedB).toHaveAttribute("aria-expanded", "false");
  await expect(songList(areaA, alpha, "1")).toBeVisible();
  await expect(songList(areaA, alpha, "2")).toBeHidden();
  await expect(songList(content, alpha, "2")).toBeHidden();

  await a.click();
  await expect(a).toHaveAttribute("aria-expanded", "false");
  await expect(songList(sidebar, alpha, "1")).toBeHidden();
  await expect(songList(areaB, beta, "1")).toBeVisible();
  await expect(page).toHaveURL(`${origin}/#/playlists`);
  await a.press("Enter");
  await expect(a).toHaveAttribute("aria-expanded", "true");
  await areaA.getByRole("button", { name: /显示更多|加载更多/ }).click();
  await expect(songList(areaA, alpha, "4")).toBeVisible();
  await expect(songList(areaA, alpha, "3")).toBeHidden();
  expect(state.continuations).toEqual([alpha + ":next"]);
  await savedA.press("Space");
  await expect(savedA).toHaveAttribute("aria-expanded", "true");
  const collected = await controlled(savedA);
  await expect(songList(collected, alpha, "2")).toBeVisible();
  await expect(songList(collected, alpha, "3")).toBeVisible();
  await expect(songList(collected, alpha, "4")).toHaveCount(0);
  await expect(savedB).toHaveAttribute("aria-expanded", "false");
  await expect(songList(areaB, beta, "2")).toBeHidden();
  await songList(collected, alpha, "3").click();
  await expect(page).toHaveURL(`${origin}/#/discover/${alpha}/3`);
  await expect(content.getByRole("heading", { name: "Mix 3" })).toBeVisible();
  await songList(areaB, beta, "1").click();
  await expect(page).toHaveURL(`${origin}/#/discover/${beta}/1`);
  await expect(content.getByRole("heading", { name: "Mix 1" })).toBeVisible();
  await sidebar.locator(`a[href="#/sources/${alpha}/playlists"]`).click();
  await expect(content.getByRole("heading", { name: /Alpha.*的歌单/ })).toBeVisible();
  for (const id of ["1", "2", "3", "4"]) await expect(songList(content, alpha, id)).toBeVisible();
  await expect(content.getByRole("button", { name: /收藏的歌单|Alpha.*的歌单/ })).toHaveCount(0);
  await sidebar.getByRole("link", { name: "歌单管理", exact: true }).click();
  await expect(songList(content, alpha, "4")).toBeVisible();
  await expect(songList(content, alpha, "3")).toBeHidden();
  await expect(songList(content, beta, "2")).toBeHidden();
  await b.press("Space");
  await page.reload();
  await expect(b).toHaveAttribute("aria-expanded", "false");
  const restoredSaved = (await controlled(a)).getByRole("button", { name: /收藏的歌单/ });
  await expect(restoredSaved).toHaveAttribute("aria-expanded", "true");
  state.alphaAccount = "another-platform-account";
  await page.reload();
  await expect((await controlled(a)).getByRole("button", { name: /收藏的歌单/ })).toHaveAttribute("aria-expanded", "false");
  await expect(b).toHaveAttribute("aria-expanded", "false");
  state.user = "another-listener";
  await page.reload();
  await expect(b).toHaveAttribute("aria-expanded", "true");
});

test("management independently folds accounts and their collected NetEase playlists across pages and reloads", async ({ page }) => {
  const state = await mockPlaylists(page);
  await page.goto(`${origin}/#/playlists`);
  const content = page.locator("#page-scroll");
  const sidebar = page.getByRole("complementary", { name: "侧栏" });
  const a = content.getByRole("region", { name: /Alpha 的歌单/ });
  const b = content.getByRole("region", { name: /Beta 的歌单/ });
  const buttonA = a.getByRole("button", { name: /Alpha 的歌单/ });
  const buttonB = b.getByRole("button", { name: /Beta 的歌单/ });
  const savedA = a.getByRole("button", { name: /收藏的歌单/ });
  const savedB = b.getByRole("button", { name: /收藏的歌单/ });
  const sideA = sidebar.getByRole("button", { name: "网易云音乐 · Alpha 的歌单", exact: true });
  const sideB = sidebar.getByRole("button", { name: "网易云音乐 · Beta 的歌单", exact: true });
  await expect(buttonA).toHaveAttribute("aria-expanded", "true");
  await expect(buttonB).toHaveAttribute("aria-expanded", "true");
  await expect(savedA).toHaveAttribute("aria-expanded", "false");
  await expect(savedB).toHaveAttribute("aria-expanded", "false");
  await expect(songList(a, alpha, "1")).toBeVisible();
  await expect(songList(a, alpha, "2")).toBeHidden();
  await expect(songList(b, beta, "1")).toBeVisible();

  await buttonB.press("Space");
  await expect(buttonB).toHaveAttribute("aria-expanded", "false");
  await expect(songList(b, beta, "1")).toBeHidden();
  await expect(sideB).toHaveAttribute("aria-expanded", "true");
  await a.getByRole("button", { name: "加载更多歌单" }).click();
  await expect(songList(a, alpha, "4")).toBeVisible();
  await expect(songList(a, alpha, "3")).toBeHidden();
  await expect(a.getByRole("button", { name: "关联本地歌单" })).toHaveCount(2);
  expect(state.continuations).toEqual([alpha + ":next"]);
  await savedA.press("Enter");
  await expect(savedA).toHaveAttribute("aria-expanded", "true");
  const saved = await controlled(savedA);
  for (const id of ["2", "3"]) await expect(songList(saved, alpha, id)).toBeVisible();
  for (const id of ["1", "4"]) await expect(songList(saved, alpha, id)).toHaveCount(0);
  await expect(saved.getByRole("button", { name: /关联/ })).toHaveCount(0);
  await expect(a.getByText("只读", { exact: true })).toHaveCount(0);
  const sideSaved = (await controlled(sideA)).getByRole("button", { name: /收藏的歌单/ });
  await expect(sideSaved).toHaveAttribute("aria-expanded", "false");
  await sideA.click();
  await expect(buttonA).toHaveAttribute("aria-expanded", "true");
  await songList(saved, alpha, "2").click();
  await expect(content.getByRole("heading", { name: "Mix 2" })).toBeVisible();
  await sidebar.getByRole("link", { name: "歌单管理", exact: true }).click();
  await page.reload();
  await expect(buttonA).toHaveAttribute("aria-expanded", "true");
  await expect(savedA).toHaveAttribute("aria-expanded", "true");
  await expect(songList(a, alpha, "2")).toBeVisible();
  await expect(buttonB).toHaveAttribute("aria-expanded", "false");
  await expect(sideA).toHaveAttribute("aria-expanded", "false");
  await expect(sideB).toHaveAttribute("aria-expanded", "true");
  await buttonB.click();
  await expect(savedB).toHaveAttribute("aria-expanded", "false");
  await sideA.click();
  await expect((await controlled(sideA)).getByRole("button", { name: /收藏的歌单/ })).toHaveAttribute("aria-expanded", "false");
});
