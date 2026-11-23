import { expect, test } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { instanceIds, neteasePlugin } from "../fixtures/plugins";

const origin = "http://127.0.0.1:18288";
let server: PreviewServer;
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18288, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

test("daily songs use the signed-in account, recover independently and stay outside playlist history", async ({ page }) => {
  const id = instanceIds.netease;
  let account = "A";
  let response: "error" | "empty" | "songs" = "error";
  const dailyRequests: string[] = [];
  const capability = (name: string) => ({ name, supported: true, reason: "" });
  await page.route("**/api/v1/**", (route) => {
    const { pathname, searchParams } = new URL(route.request().url());
    let json: unknown = { items: [], nextAfter: null };
    if (pathname.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "fixture" };
    if (pathname.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "listener", role: "user" } };
    if (pathname.endsWith("/online-instances")) {
      const source = { instanceId: id, platform: "netease", plugin: neteasePlugin, name: account, accountId: account,
        accountRevision: account, availability: "available", capabilities: [capability("recommendations.tracks")] };
      json = { items: [
        { ...source, capabilities: [...source.capabilities, ...(account === "A" ? [capability("stream.resolve"), capability("playlist.addTracks")] : [])] },
        { ...source, instanceId: instanceIds.neteaseSecond, availability: "loginRequired", accountId: undefined },
        { ...source, instanceId: instanceIds.custom, capabilities: [] },
      ] };
    }
    if (pathname.endsWith("/daily-songs")) {
      dailyRequests.push(pathname);
      expect(searchParams.get("limit")).toBe("50");
      if (response === "error") return route.fulfill({ status: 503, json: { error: { code: "TEMPORARY_FAILURE", requestId: "daily-attempt" } } });
      const track = { externalId: "1", title: `Song ${account}`, artists: ["Artist"], album: "", durationMs: 95000, sourceUrl: "" };
      json = { tracks: response === "empty" ? [] : [track], observedAt: "2026-11-23T00:00:00Z" };
    }
    if (pathname.endsWith("/recommendations")) {
      const title = searchParams.has("history") ? "Past playlist" : "Current playlist";
      json = { historyDepth: 1, sources: [{ instanceId: id, items: [{ playlist: { externalId: "mix", title, trackCount: 1 } }] }] };
    }
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/recommendations`);
  const daily = page.getByRole("region", { name: /每日推荐歌曲$/ });
  await expect(daily.getByRole("alert")).toContainText("daily-attempt");
  await expect(page.getByRole("link", { name: /Current playlist/ })).toBeVisible();
  response = "empty";
  await daily.getByRole("button", { name: "重试" }).click();
  await expect(daily.getByText("此账号今天暂无推荐歌曲。")).toBeVisible();
  response = "songs";
  await daily.getByRole("button", { name: "刷新每日推荐歌曲" }).click();
  await expect(daily.getByRole("cell", { name: "Song A", exact: true })).toBeVisible();
  await expect(daily.getByRole("button", { name: "播放 Song A" })).toBeVisible();
  await expect(daily.getByRole("button", { name: "将 Song A 添加到歌单" })).toBeVisible();
  await page.getByRole("button", { name: "时光机" }).click();
  await expect(page.getByRole("link", { name: /Past playlist/ })).toBeVisible();
  await expect(daily).toHaveCount(0);
  await page.getByRole("button", { name: "返回最新推荐" }).click();
  await expect(daily.getByText("Song A")).toBeVisible();
  account = "B";
  await page.goto(`${origin}/#/search`);
  await expect(page.getByRole("combobox").first()).toContainText("B");
  await page.goto(`${origin}/#/recommendations`);
  await expect(daily.getByRole("cell", { name: "Song B", exact: true })).toBeVisible();
  await expect(page.getByText("Song A", { exact: true })).toHaveCount(0);
  await expect(daily.getByRole("button", { name: "加入队列" })).toHaveCount(0);
  await expect(daily.getByRole("button", { name: /添加到歌单/ })).toHaveCount(0);
  expect(new Set(dailyRequests)).toEqual(new Set([`/api/v1/online-instances/${id}/daily-songs`]));
});
