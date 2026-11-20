import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { candidate, completeCandidate, details, detailsToggle, mock } from "./album-scraping-mock";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

async function scrapedAlbum(page: Page) {
  const state = await mock(page);
  state.saved = [{ field: "albumDetails", pluginId: "album-source", item: candidate },
    { field: "albumTracks", pluginId: "album-source", item: completeCandidate }];
  state.album.sourceLinks = [{ pluginId: "album-source", url: candidate.sourceUrl }];
  state.applied = true;
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}&categoryId=one`);
  await detailsToggle(page).click();
  return state;
}

const openClear = (page: Page) => details(page).getByRole("button", { name: "清空刮削资料", exact: true }).click();
const dialog = (page: Page) => page.getByRole("dialog", { name: "清空刮削资料", exact: true });
const endpoint = "**/api/v1/library/albums/one/scraped-fields";

test("clearing an album requires confirmation and refreshes its saved metadata and track list", async ({ page }) => {
  const state = await scrapedAlbum(page);
  const writes: unknown[] = [];
  await page.route(endpoint, async route => {
    const request = route.request();
    if (request.method() !== "DELETE") return route.fallback();
    writes.push(request.postDataJSON());
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    state.saved = []; state.applied = false; state.album.revision++;
    return route.fulfill({ json: { revision: state.album.revision } });
  });
  await openClear(page);
  await expect(dialog(page)).toContainText(state.album.name);
  await dialog(page).getByRole("button", { name: "取消", exact: true }).click();
  expect(writes).toEqual([]);
  await expect(page.getByRole("row").filter({ hasText: "未收录曲目" })).toBeVisible();
  await openClear(page);
  await dialog(page).getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(details(page)).toContainText("尚无在线专辑资料");
  await expect(details(page).getByRole("button", { name: "清空刮削资料" })).toHaveCount(0);
  await expect(details(page).getByRole("link", { name: /example.org/ })).toBeVisible();
  await expect(details(page).getByRole("button", { name: "刷新资料" })).toBeEnabled();
  await expect(page.locator(".tracks tbody tr")).toHaveCount(2);
  expect(writes).toEqual([{ expectedRevision: 1 }]);
  expect(state.searches).toEqual([]);
});

test("a conflicting clear reloads the album and requires fresh confirmation", async ({ page }) => {
  const state = await scrapedAlbum(page);
  const expected: number[] = [];
  await page.route(endpoint, route => {
    const request = route.request();
    if (request.method() !== "DELETE") return route.fallback();
    expected.push(request.postDataJSON().expectedRevision);
    if (expected.length === 1) {
      state.album.revision++;
      return route.fulfill({ status: 409, json: { error: { code: "CONFLICT", requestId: "album-changed" } } });
    }
    state.album.revision++; state.saved = []; state.applied = false;
    return route.fulfill({ json: { revision: state.album.revision } });
  });
  await openClear(page);
  await dialog(page).getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("album-changed");
  await expect(dialog(page).getByRole("button", { name: "确认清空", exact: true })).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "刷新资料", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(expected).toEqual([1]);
  await openClear(page);
  await dialog(page).getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(details(page)).toContainText("尚无在线专辑资料");
  expect(expected).toEqual([1, 2]);
});

test("an uncertain clear only replays when clicked, with the original revision and key", async ({ page }) => {
  const state = await scrapedAlbum(page);
  const attempts: { key: string; revision: number }[] = [];
  await page.route(endpoint, route => {
    const request = route.request();
    if (request.method() !== "DELETE") return route.fallback();
    attempts.push({ key: request.headers()["idempotency-key"], revision: request.postDataJSON().expectedRevision });
    if (attempts.length === 1) {
      state.saved = []; state.applied = false; state.album.revision++;
      return route.abort("connectionreset");
    }
    return route.fulfill({ json: { revision: state.album.revision } });
  });
  await openClear(page);
  await dialog(page).getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("清空结果待确认");
  expect(attempts).toHaveLength(1);
  await dialog(page).getByRole("button", { name: "重试确认清空", exact: true }).click();
  await expect(details(page)).toContainText("尚无在线专辑资料");
  expect(attempts).toEqual([{ key: expect.any(String), revision: 1 }, attempts[0]]);
});
