import { expect, test, type Locator } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { instanceIds, neteasePlugin } from "../fixtures/plugins";

const origin = "http://127.0.0.1:18290";
let server: PreviewServer;
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18290, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

test("account folders and their saved NetEase playlists fold independently across pages", async ({ page }) => {
  const alpha = instanceIds.netease, beta = instanceIds.neteaseSecond;
  let user = "listener", alphaAccount = "Alpha";
  const instance = (instanceId: string, name: string) => ({
    instanceId, name, accountId: instanceId === alpha ? alphaAccount : name, accountRevision: "1",
    plugin: neteasePlugin, platform: "netease", availability: "available",
    capabilities: [{ name: "playlist.list", supported: true, reason: "" }],
  });
  const mix = (externalId: string, writable?: boolean) => ({ externalId, title: `Mix ${externalId}`, writable,
    sourceUrl: "", trackCount: 1, coverUrl: null });
  const continuations: string[] = [];
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    let json: unknown = { items: [], nextAfter: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "fixture" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: user, role: "user" } };
    if (path.endsWith("/online-instances")) json = { items: [instance(alpha, "Alpha"), instance(beta, "Beta")] };
    const list = path.match(/^\/api\/v1\/online-instances\/([^/]+)\/playlists$/);
    if (list) {
      const cursor = url.searchParams.get("cursor");
      if (cursor) continuations.push(list[1] + ":" + cursor);
      json = { items: cursor ? [mix("3"), mix("4", true)] : [mix("1", true), mix("2", false)],
        nextCursor: list[1] === alpha && !cursor ? "next" : null, consistency: "unversioned", observedAt: "2026-11-23T00:00:00Z" };
    }
    const detail = path.match(/\/playlists\/(\d+)(\/tracks)?$/);
    if (detail) json = detail[2] ? { playlist: mix(detail[1]), items: [], nextCursor: null } :
      { playlist: mix(detail[1]), entries: [], complete: true, observedAt: "2026-11-23T00:00:00Z" };
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/playlists`);
  const sidebar = page.getByRole("complementary", { name: "侧栏" });
  const content = page.locator("#page-scroll");
  const folder = (label: string) => sidebar.locator("button[aria-expanded]").filter({ hasText: label });
  const a = folder("Alpha"), b = folder("Beta");
  async function controlled(button: Locator) {
    const id = await button.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    return sidebar.locator(`[id="${id}"]`);
  }
  const songList = (scope: Locator, account: string, external: string) => scope.locator(`a[href="#/discover/${account}/${external}"]`);
  await expect(a).toHaveAttribute("aria-expanded", "true");
  await expect(b).toHaveAttribute("aria-expanded", "true");
  const areaA = await controlled(a), areaB = await controlled(b);
  const savedA = areaA.getByRole("button", { name: /收藏的歌单/ });
  const savedB = areaB.getByRole("button", { name: /收藏的歌单/ });
  await expect(savedA).toHaveAttribute("aria-expanded", "false");
  await expect(savedB).toHaveAttribute("aria-expanded", "false");
  await expect(songList(areaA, alpha, "1")).toBeVisible();
  await expect(songList(areaA, alpha, "2")).toBeHidden();
  await expect(songList(content, alpha, "2")).toBeVisible();

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
  expect(continuations).toEqual([alpha + ":next"]);
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
  await sidebar.getByRole("link", { name: "歌单管理", exact: true }).click();
  await expect(songList(content, alpha, "3")).toBeVisible();
  await expect(songList(content, beta, "2")).toBeVisible();
  await b.press("Space");
  await page.reload();
  await expect(b).toHaveAttribute("aria-expanded", "false");
  const restoredSaved = (await controlled(a)).getByRole("button", { name: /收藏的歌单/ });
  await expect(restoredSaved).toHaveAttribute("aria-expanded", "true");
  alphaAccount = "another-platform-account";
  await page.reload();
  await expect((await controlled(a)).getByRole("button", { name: /收藏的歌单/ })).toHaveAttribute("aria-expanded", "false");
  await expect(b).toHaveAttribute("aria-expanded", "false");
  user = "another-listener";
  await page.reload();
  await expect(b).toHaveAttribute("aria-expanded", "true");
});
