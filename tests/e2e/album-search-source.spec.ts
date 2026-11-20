import { expect, test, type Route } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { album, candidate, mock, dialog, details, openAlbum } from "./album-scraping-mock";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

const platforms = ["album-source", "second-source"].map((pluginId, index) => ({
  pluginId, name: index ? "第二平台" : "第一平台", type: "scraper", available: true, fields: ["albumDetails", "albumTracks"]
}));

test("album search queries only its selected platform and preserves other saved links", async ({ page }) => {
  const state = await mock(page);
  state.album.sourceLinks = [{ pluginId: "album-source", url: candidate.sourceUrl }];
  const secondQueries: { field: string; query: Record<string, string> }[] = [];
  const second = { ...candidate, id: "other-edition", title: "第二个平台版本", sourceUrl: "https://second.example.org/other-edition" };
  let failSecond = true;
  await page.route("**/api/v1/scrapers", route => route.fulfill({ json: { items: platforms } }));
  await page.route("**/api/v1/scrapers/second-source/search", route => {
    const input = route.request().postDataJSON();
    secondQueries.push(input);
    if (failSecond) return route.fulfill({ status: 503, json: { error: { code: "SOURCE_UNAVAILABLE" } } });
    return route.fulfill({ json: { items: [{ ...second, candidateToken: input.field + "-second",
      ...(input.field === "albumTracks" ? { tracks: [{ title: "另一发行版第一首" }] } : {}) }] } });
  });
  await openAlbum(page, origin);
  const modal = dialog(page);
  const firstRadio = modal.getByRole("radio", { name: "第一平台", exact: true });
  const secondRadio = modal.getByRole("radio", { name: "第二平台", exact: true });
  const url = modal.getByLabel("平台专辑页面（可选）", { exact: true });
  const search = modal.getByRole("button", { name: "搜索", exact: true });
  await expect(firstRadio).toBeChecked();
  await url.fill(candidate.sourceUrl);
  await search.click();
  await expect(modal.getByRole("region", { name: "第一平台" }).getByText(candidate.title)).toBeVisible();
  expect(secondQueries).toEqual([]);
  await secondRadio.check();
  await expect(firstRadio).not.toBeChecked();
  await expect(url).toHaveValue("");
  await expect(modal.getByRole("region", { name: "第一平台" })).toHaveCount(0);
  await search.click();
  await expect(modal.getByRole("alert")).toBeVisible();
  failSecond = false;
  await search.click();
  await modal.getByRole("region", { name: "第二平台" }).getByRole("checkbox", { name: "关联此页面" }).check();
  expect(state.searches).toEqual([{ field: "albumDetails", query: { sourceUrl: candidate.sourceUrl } }]);
  expect(secondQueries).toEqual(Array(2).fill({ field: "albumDetails", query: { title: album.originalName } }));
  await modal.getByRole("button", { name: "保存选中平台链接" }).click();
  await expect(modal).toHaveCount(0);
  expect(state.album.sourceLinks).toEqual([{ pluginId: "album-source", url: candidate.sourceUrl }, { pluginId: "second-source", url: second.sourceUrl }]);
  expect(state.saved).toEqual([]);
  await details(page).getByRole("button", { name: "刷新资料" }).click();
  const panel = page.getByRole("dialog", { name: "对比专辑资料" });
  await expect(panel.getByRole("button", { name: "读取平台资料" })).toBeDisabled();
  const before = state.searches.length;
  await panel.getByLabel("资料平台").selectOption("second-source");
  await panel.getByRole("button", { name: "读取平台资料" }).click();
  await expect(panel.getByRole("checkbox", { name: "曲目表" })).toBeVisible();
  expect(state.searches).toHaveLength(before);
  expect(secondQueries.slice(-2)).toEqual([{ field: "albumDetails", query: { sourceUrl: second.sourceUrl }, refresh: true },
    { field: "albumTracks", query: { externalId: second.id, sourceUrl: second.sourceUrl }, refresh: true }]);
});

test("switching platforms discards the old selection and a pending search", async ({ page }) => {
  const state = await mock(page);
  await page.route("**/api/v1/scrapers", route => route.fulfill({ json: { items: platforms } }));
  const second = { ...candidate, title: "第二平台的搜索结果", candidateToken: "second" };
  await page.route("**/api/v1/scrapers/second-source/search", route => route.fulfill({ json: { items: [second] } }));
  await openAlbum(page, origin);
  const modal = dialog(page);
  const search = modal.getByRole("button", { name: "搜索", exact: true });
  const save = modal.getByRole("button", { name: "保存选中平台链接" });
  const firstRadio = modal.getByRole("radio", { name: "第一平台" });
  const secondRadio = modal.getByRole("radio", { name: "第二平台" });
  await search.click();
  await modal.getByRole("checkbox", { name: "关联此页面" }).check();
  await expect(save).toBeVisible();
  await secondRadio.check();
  await expect(save).toHaveCount(0);
  await firstRadio.check();

  let receive!: (route: Route) => void;
  const delayed = new Promise<Route>(resolve => { receive = resolve; });
  await page.route("**/api/v1/scrapers/album-source/search", route => { receive(route); });
  await search.click();
  const oldRequest = await delayed;
  await secondRadio.check();
  await search.click();
  await expect(modal.getByText(second.title, { exact: true })).toBeVisible();
  await oldRequest.fulfill({ json: { items: [{ ...candidate, candidateToken: "expired" }] } });
  await expect(modal.getByRole("region", { name: "第一平台" })).toHaveCount(0);
  await expect(modal.getByText(second.title, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
});
