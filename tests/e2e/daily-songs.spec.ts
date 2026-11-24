import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { instanceIds, neteasePlugin } from "../fixtures/plugins";

const origin = "http://127.0.0.1:18288";
let server: PreviewServer;
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18288, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const id = instanceIds.netease;
const dailyPath = `#/recommendations/${id}/daily-songs`;
async function mockRecommendations(page: Page) {
  const state: { account: string; response: "error" | "empty" | "songs"; feed: "same" | "other" | "empty"; dailyRequests: string[] } = {
    account: "A", response: "error", feed: "same", dailyRequests: [],
  };
  const capability = (name: string) => ({ name, supported: true, reason: "" });
  await page.route("**/api/v1/**", (route) => {
    const { pathname, searchParams } = new URL(route.request().url());
    let json: unknown = { items: [], nextAfter: null };
    if (pathname.endsWith("/me/favorites")) json = { items: [], nextCursor: null, revision: "1" };
    if (pathname.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "fixture" };
    if (pathname.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "listener", role: "user" } };
    if (pathname.endsWith("/online-instances")) {
      const account = state.account;
      const source = { instanceId: id, platform: "netease", plugin: neteasePlugin, name: account, accountId: account,
        accountRevision: account, availability: "available", capabilities: [capability("recommendations.tracks")] };
      json = { items: [
        { ...source, capabilities: [...source.capabilities, ...(account === "A" ? [capability("stream.resolve"), capability("playlist.addTracks")] : [])] },
        { ...source, instanceId: instanceIds.neteaseSecond, availability: "loginRequired", accountId: undefined },
        { ...source, instanceId: instanceIds.custom, capabilities: [] },
      ] };
    }
    if (pathname.endsWith("/daily-songs")) {
      state.dailyRequests.push(pathname);
      expect(searchParams.get("limit")).toBe("50");
      if (state.response === "error") return route.fulfill({ status: 503, json: { error: { code: "TEMPORARY_FAILURE", requestId: "daily-attempt" } } });
      const track = { externalId: "1", title: `Song ${state.account}`, artists: ["Artist"], album: "", durationMs: 95000, sourceUrl: "" };
      json = { tracks: state.response === "empty" ? [] : [track], observedAt: "2026-11-23T00:00:00Z" };
    }
    if (pathname.endsWith("/recommendations")) {
      const title = searchParams.has("history") ? "Past playlist" : "Current playlist";
      const source = { instanceId: state.feed === "other" ? instanceIds.custom : id,
        items: [{ playlist: { externalId: "mix", title, trackCount: 1 } }] };
      json = { historyDepth: 1, sources: state.feed === "empty" ? [] : [source] };
    }
    return route.fulfill({ json });
  });
  return state;
}

test("only the current grid links to daily songs, and track requests start on the account detail page", async ({ page }) => {
  const state = await mockRecommendations(page);
  await page.goto(`${origin}/#/recommendations`);
  const content = page.locator("#page-scroll");
  const current = content.getByRole("link", { name: /Current playlist/ });
  const grid = content.locator(".cards").filter({ has: page.getByRole("link", { name: /Current playlist/ }) });
  const dailyCards = content.locator('a[href$="/daily-songs"]');
  const card = grid.locator(`a[href="${dailyPath}"]`);
  await expect(card).toHaveAccessibleName(/每日推荐歌曲/);
  await expect(card).toBeVisible();
  await expect(dailyCards).toHaveCount(1);
  await expect(content.getByRole("table")).toHaveCount(0);
  const history = content.getByRole("button", { name: "时光机" });
  const popup = page.getByRole("dialog", { name: "时光机" });
  await history.click();
  await popup.getByRole("button", { name: "历史推荐（1/1）", exact: true }).click();
  await expect(content.getByRole("link", { name: /Past playlist/ })).toBeVisible();
  await expect(dailyCards).toHaveCount(0);
  await history.click();
  await popup.getByRole("button", { name: "最新推荐", exact: true }).click();
  await expect(card).toBeVisible();
  expect(state.dailyRequests).toEqual([]);
  await card.click();
  await expect(page).toHaveURL(`${origin}/${dailyPath}`);
  const daily = content;
  await expect(daily.getByRole("alert")).toContainText("daily-attempt");
  await expect(current).toHaveCount(0);
  state.response = "empty";
  await daily.getByRole("button", { name: "重试" }).click();
  await expect(daily.getByText("此账号今天暂无推荐歌曲。")).toBeVisible();
  state.response = "songs";
  await daily.getByRole("button", { name: "刷新每日推荐歌曲" }).click();
  await expect(daily.getByRole("cell", { name: "Song A", exact: true })).toBeVisible();
  await expect(daily.getByRole("button", { name: "播放 Song A" })).toBeVisible();
  await daily.getByRole("button", { name: "Song A 的更多操作" }).click();
  await expect(page.getByRole("menuitem", { name: "添加到歌单", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const reads = state.dailyRequests.length;
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/#/recommendations`);
  await expect(card).toBeVisible();
  expect(state.dailyRequests).toHaveLength(reads);
  state.account = "B";
  await page.goto(`${origin}/#/search`);
  await expect(page.getByRole("combobox").first()).toContainText("B");
  await page.goto(`${origin}/#/recommendations`);
  await expect(card).toBeVisible();
  expect(state.dailyRequests).toHaveLength(reads);
  await card.click();
  await expect(daily.getByRole("cell", { name: "Song B", exact: true })).toBeVisible();
  await expect(page.getByText("Song A", { exact: true })).toHaveCount(0);
  await expect(daily.getByRole("button", { name: "将 Song B 加入队列" })).toHaveCount(0);
  await expect(daily.getByRole("button", { name: "Song B 的更多操作" })).toHaveCount(0);
  expect(new Set(state.dailyRequests)).toEqual(new Set([`/api/v1/online-instances/${id}/daily-songs`]));
});

test("a direct daily-song URL cannot read from a signed-out or unsupported instance", async ({ page }) => {
  const state = await mockRecommendations(page);
  for (const source of [instanceIds.neteaseSecond, instanceIds.custom]) {
    await page.goto(`${origin}/#/recommendations/${source}/daily-songs`);
    const content = page.locator("#page-scroll");
    await expect(content).toContainText(/登录|不支持|不可用|推荐歌单/);
    await expect(content.getByRole("table")).toHaveCount(0);
  }
  expect(state.dailyRequests).toEqual([]);
});

test("an eligible account keeps one daily card when the feed contains other sources or no playlists", async ({ page }) => {
  const state = await mockRecommendations(page);
  state.feed = "other";
  await page.goto(`${origin}/#/recommendations`);
  const content = page.locator("#page-scroll");
  const ordinary = page.getByRole("link", { name: /Current playlist/ });
  const card = content.locator(`.cards a[href="${dailyPath}"]`);
  await expect(ordinary).toBeVisible();
  await expect(card).toBeVisible();
  await expect(content.locator(".cards").filter({ has: ordinary }).locator('a[href$="/daily-songs"]')).toHaveCount(0);
  await expect(content.locator('a[href$="/daily-songs"]')).toHaveCount(1);
  state.feed = "empty";
  await content.getByRole("button", { name: "刷新推荐", exact: true }).click();
  await expect(ordinary).toHaveCount(0);
  await expect(card).toBeVisible();
  await expect(content.locator(".cards a")).toHaveCount(1);
  await expect(content.getByText("尚未配置可用的推荐来源。")).toHaveCount(0);
  expect(state.dailyRequests).toEqual([]);
});

for (const width of [375, 1280]) {
  test(`playlist title and recommendation controls share a row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockRecommendations(page);
    await page.goto(`${origin}/#/recommendations`);
    const content = page.locator("#page-scroll");
    const heading = content.getByRole("heading", { name: "推荐歌单", exact: true });
    const history = content.getByRole("button", { name: "时光机", exact: true });
    const refresh = content.getByRole("button", { name: "刷新推荐", exact: true });
    const popup = page.getByRole("dialog", { name: "时光机", exact: true });
    async function expectRow() {
      const boxes = await Promise.all([heading, history, refresh].map(async (control) => {
        await expect(control).toBeVisible();
        return (await control.boundingBox())!;
      }));
      expect(Math.max(...boxes.map((box) => box.y))).toBeLessThan(Math.min(...boxes.map((box) => box.y + box.height)));
      for (const [index, box] of boxes.entries()) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        if (index > 0) expect(boxes[index - 1].x + boxes[index - 1].width).toBeLessThanOrEqual(box.x + 1);
      }
    }
    await expect(content.getByRole("link", { name: /Current playlist/ })).toBeVisible();
    await expectRow();
    const firstCard = content.locator(".music-card").first();
    const cardTop = await firstCard.evaluate(element => element.getBoundingClientRect().top);
    await history.click();
    await expect(popup).toBeVisible();
    await expect(history).toHaveAttribute("aria-expanded", "true");
    await expect(content.getByRole("link", { name: /Current playlist/ })).toBeVisible();
    expect(await firstCard.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(cardTop, 0);
    const box = (await popup.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);

    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(history).toBeFocused();
    await history.click();
    await heading.click();
    await expect(popup).toBeHidden();
    await expect(history).toHaveAttribute("aria-expanded", "false");
    await history.click();
    await popup.getByRole("button", { name: "历史推荐（1/1）", exact: true }).click();
    await expect(content.getByRole("link", { name: /Past playlist/ })).toBeVisible();
    await expect(popup).toBeHidden();
    expect(await firstCard.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(cardTop, 0);
    await expectRow();
  });
}
