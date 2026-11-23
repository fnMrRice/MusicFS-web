import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { instanceIds, neteasePlugin } from "../fixtures/plugins";

const port = 18327;
const origin = `http://127.0.0.1:${port}`;
let server: PreviewServer;
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

function account(id: string, name: string, titles: string[]) {
  return { id, name, label: `网易云音乐 · ${name}`, titles };
}
const first = account(instanceIds.netease, "Studio Z", ["Zebra mix", "Amber mix"]);
const second = account(instanceIds.neteaseSecond, "Studio A", ["Winter mix", "Autumn mix"]);
const newFirst = account(instanceIds.custom, "Guest Z", ["Orchid mix"]);
const newSecond = account(instanceIds.qqmusic, "Guest A", ["Forest mix"]);
type Account = typeof first;

async function mock(page: Page) {
  const state = { sources: [first, second], refreshes: 0, serverId: "fixture", listener: "listener" };
  await page.route("**/api/v1/**", (route) => {
    const { pathname, searchParams } = new URL(route.request().url());
    let json: unknown = { items: [], nextAfter: null };
    if (pathname.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: state.serverId };
    if (pathname.endsWith("/auth/session")) json = { csrfToken: "test", user: { id: state.listener, role: "user" } };
    if (pathname.endsWith("/online-instances")) json = { items: state.sources.map(({ id, name }) => ({
      instanceId: id, name, accountId: "account-" + id, accountRevision: "1", platform: "netease", plugin: neteasePlugin,
      availability: "available", capabilities: ["recommendations.playlists", "recommendations.tracks"].map(capability =>
        ({ name: capability, supported: true, reason: "" })),
    })) };
    if (pathname.endsWith("/recommendations")) {
      if (searchParams.get("refresh") === "true") state.refreshes++;
      json = { historyDepth: 0, sources: state.sources.map(({ id, titles }) => ({
        instanceId: id, items: titles.map((title, position) => ({
          playlist: { externalId: String(9 - position), title, trackCount: 1 }, position, reason: "",
        })),
      })) };
    }
    return route.fulfill({ json });
  });
  return state;
}

const content = (page: Page) => page.locator("#page-scroll");
const toggle = (page: Page, name: string) => content(page).getByRole("heading", { name, exact: true }).getByRole("button");
const sourceHeadings = (page: Page) => content(page).getByRole("heading", { level: 3 });

async function expectCards(page: Page, source: Account) {
  const button = toggle(page, source.label);
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const regionId = await button.getAttribute("aria-controls");
  expect(regionId).toBeTruthy();
  const cards = page.locator(`[id=${JSON.stringify(regionId)}]`).getByRole("link");
  await expect(cards.locator("strong")).toHaveText(["每日推荐歌曲", ...source.titles]);
  await expect(cards.first()).toHaveAttribute("href", `#/recommendations/${source.id}/daily-songs`);
  for (const [index] of source.titles.entries()) {
    await expect(cards.nth(index + 1)).toHaveAttribute("href", `#/discover/${source.id}/${9 - index}`);
  }
}

test("the recommendation heading stays visible and source groups keep independent collapse preferences", async ({ page }) => {
  const state = await mock(page);
  await page.addInitScript(() => {
    const key = "musicfs:recommendations:listener:collapsedRecommendations";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(["all"]));
  });
  await page.goto(`${origin}/#/recommendations`);
  const heading = content(page).getByRole("heading", { name: "推荐歌单", level: 2, exact: true });
  const a = toggle(page, first.label);
  const b = toggle(page, second.label);
  await expect(heading).toBeVisible();
  await expect(heading.getByRole("button")).toHaveCount(0);
  await expect(sourceHeadings(page)).toHaveText([first.label, second.label]);
  await expectCards(page, first);
  await expectCards(page, second);

  await a.press("Space");
  await expect(a).toHaveAttribute("aria-expanded", "false");
  await expect(content(page).getByRole("link", { name: /Zebra mix/ })).toBeHidden();
  await expectCards(page, second);
  await content(page).getByRole("button", { name: "刷新推荐", exact: true }).click();
  await expect.poll(() => state.refreshes).toBe(1);
  await expect(a).toHaveAttribute("aria-expanded", "false");
  await expectCards(page, second);
  await page.reload();
  await expect(a).toHaveAttribute("aria-expanded", "false");
  await expectCards(page, second);
  await b.click();
  await a.press("Enter");
  await expectCards(page, first);
  await expect(b).toHaveAttribute("aria-expanded", "false");
  await expect(content(page).getByRole("link", { name: /Winter mix/ })).toBeHidden();
  state.serverId = "restarted-server";
  await page.reload();
  await expect(a).toHaveAttribute("aria-expanded", "true");
  await expect(b).toHaveAttribute("aria-expanded", "false");
  state.listener = "other-listener";
  await page.reload();
  await expectCards(page, first);
  await expectCards(page, second);
  state.listener = "listener";
  await page.reload();
  await expectCards(page, first);
  await expect(b).toHaveAttribute("aria-expanded", "false");
});

test("appearance immediately reorders individual sources, preserves every card and appends new sources in feed order", async ({ page }) => {
  const state = await mock(page);
  await page.goto(`${origin}/#/recommendations`);
  await expect(sourceHeadings(page)).toHaveText([first.label, second.label]);
  await expectCards(page, first);
  await expectCards(page, second);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "外观与语言" }).click();
  const settings = page.getByRole("region", { name: "推荐来源排序", exact: true });
  const rows = settings.getByRole("listitem");
  const move = (direction: string, source: Account) => settings.getByRole("button", { name: direction + " " + source.label, exact: true });
  async function expectOrder(top: Account, bottom: Account) {
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(top.label);
    await expect(rows.nth(1)).toContainText(bottom.label);
    await expect(move("上移", top)).toBeDisabled();
    await expect(move("下移", bottom)).toBeDisabled();
    await expect(move("下移", top)).toBeEnabled();
    await expect(move("上移", bottom)).toBeEnabled();
    await expect(settings.getByRole("button", { name: /^(上移|下移) / })).toHaveCount(4);
  }
  await expectOrder(first, second);
  await move("下移", first).click();
  await expectOrder(second, first);
  await move("上移", first).click();
  await expectOrder(first, second);
  await move("上移", second).click();
  await expectOrder(second, first);
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "推荐", exact: true }).click();
  await expect(sourceHeadings(page)).toHaveText([second.label, first.label]);
  await expectCards(page, first);
  await expectCards(page, second);
  await expect(content(page).getByRole("button", { name: /上移|下移|排序/ })).toHaveCount(0);
  await page.reload();
  await expect(sourceHeadings(page)).toHaveText([second.label, first.label]);

  // 新来源穿插在返回结果中，未设置顺序的两个来源仍保持服务端相对顺序。
  state.sources = [newFirst, first, newSecond, second];
  await page.reload();
  await expect(sourceHeadings(page)).toHaveText([second.label, first.label, newFirst.label, newSecond.label]);
  for (const source of state.sources) await expectCards(page, source);
  state.serverId = "restarted-server";
  await page.reload();
  await expect(sourceHeadings(page)).toHaveText([second.label, first.label, newFirst.label, newSecond.label]);
  state.listener = "other-listener";
  await page.reload();
  await expect(sourceHeadings(page)).toHaveText(state.sources.map(source => source.label));
  state.listener = "listener";
  await page.reload();
  await expect(sourceHeadings(page)).toHaveText([second.label, first.label, newFirst.label, newSecond.label]);
});
