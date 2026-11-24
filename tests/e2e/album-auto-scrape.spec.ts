import { expect, test } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { album, candidate, completeCandidate, mock, openAlbum, details, detailsToggle } from "./album-scraping-mock";
import { track } from "../fixtures/dto";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

test("auto-scrape falls back to the first complete edition and retries an uncertain save with the same selection", async ({ page }) => {
  const state = await mock(page);
  const provider = track.providerInstanceId;
  const writes: { key: string; body: unknown }[] = [];
  const attempted: string[] = [];
  let searches = 0;
  await page.route("**/api/v1/library/albums?*", route => {
    const query = new URL(route.request().url()).searchParams;
    const items = query.get("unscrapedOnly") === "true" && state.saved.length ? [] : [{ ...album, trackCount: 2 }];
    return route.fulfill({ json: { items, nextAfter: null } });
  });
  await page.route("**/api/v1/library/albums/one/auto-scrape", route => {
    searches++;
    expect(route.request().postDataJSON()).toEqual({ providerInstanceId: provider });
    return route.fulfill({ json: { items: ["missing", candidate.id, "third"].map(id => ({
      ...candidate, id, pluginId: "musicfs.scraper.musicbrainz", candidateToken: "details-" + id,
    })) } });
  });
  await page.route("**/api/v1/scrapers/musicfs.scraper.musicbrainz/search", route => {
    const { query, field } = route.request().postDataJSON();
    expect(field).toBe("albumTracks");
    attempted.push(query.externalId);
    return route.fulfill({ json: { items: query.externalId === candidate.id
      ? [{ ...completeCandidate, candidateToken: "tracks-token" }] : [] } });
  });
  await page.route("**/api/v1/library/albums/one/scraped-fields", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { items: state.saved } });
    const body = route.request().postDataJSON();
    writes.push({ body, key: route.request().headers()["idempotency-key"] });
    if (writes.length === 1) {
      state.saved.push({ field: "albumDetails", pluginId: body.pluginId, item: candidate });
      return route.fulfill({ status: 503, json: { error: { code: "TEMPORARY_FAILURE" } } });
    }
    return route.fulfill({ json: { revision: 2 } });
  });
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}&source=${provider}`);
  const unscrapedOnly = page.getByRole("checkbox", { name: "仅显示未刮削专辑" });
  await unscrapedOnly.click();
  await expect(unscrapedOnly).toBeChecked();
  await page.getByRole("button", { name: "列表视图" }).click();
  await page.getByRole("button", { name: `${album.name} 的更多操作` }).click();
  await page.getByRole("menuitem", { name: "自动刮削" }).click();
  const modal = page.getByRole("dialog", { name: "自动刮削" });
  await expect(modal.getByRole("alert")).toContainText("保存结果待确认");
  await modal.getByRole("button", { name: "重试", exact: true }).click();
  await expect(modal.getByRole("status")).toContainText(`已采用 MusicBrainz 的《${candidate.title}》。`);
  expect(searches).toBe(1);
  expect(attempted).toEqual(["missing", candidate.id]);
  expect(writes).toHaveLength(2);
  expect(writes[0].key).toBeTruthy();
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0].body).toEqual({ expectedRevision: 1, pluginId: "musicfs.scraper.musicbrainz",
    candidates: { albumDetails: "details-" + candidate.id, albumTracks: "tracks-token" } });
  await modal.getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("heading", { name: "没有符合条件的未刮削专辑" })).toBeVisible();
  await page.getByRole("checkbox", { name: "仅显示未刮削专辑" }).uncheck();
  await page.getByRole("button", { name: `${album.name} 的更多操作` }).click();
  await page.getByRole("menuitem", { name: "自动刮削" }).click();
  await expect(modal.getByRole("status")).toContainText(`将采用 MusicBrainz 的《${candidate.title}》`);
  await modal.getByRole("button", { name: "取消", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(searches).toBe(2);
  expect(writes).toHaveLength(2);
});

test("album details support an empty ranked search without changing the album", async ({ page }) => {
  const state = await mock(page);
  await page.route("**/api/v1/library/albums/one/auto-scrape", route => {
    expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({ json: { items: [] } });
  });
  await openAlbum(page, origin, false);
  await detailsToggle(page).click();
  await details(page).getByRole("button", { name: "自动刮削", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText("没有匹配的资料。");
  expect(state.writes).toHaveLength(0);
});

test("auto-scrape uses the third release after an expired and an invalid candidate", async ({ page }) => {
  await mock(page);
  const pluginId = "musicfs.scraper.musicbrainz";
  const ids = ["expired", "invalid", "complete"];
  const submitted: string[] = [];
  await page.route("**/api/v1/library/albums/one/auto-scrape", route => route.fulfill({
    json: { items: ids.map(id => ({ id, title: id, pluginId, candidateToken: id })) },
  }));
  await page.route("**/api/v1/scrapers/musicfs.scraper.musicbrainz/search", route => {
    const id = route.request().postDataJSON().query.externalId;
    return route.fulfill({ json: { items: [{ ...completeCandidate, id, candidateToken: id + "-tracks" }] } });
  });
  await page.route("**/api/v1/library/albums/one/scraped-fields", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { items: [] } });
    const id = route.request().postDataJSON().candidates.albumDetails;
    submitted.push(id);
    if (id === "expired") return route.fulfill({ status: 404,
      json: { error: { code: "NOT_FOUND", message: "Scraper candidate expired or unavailable" } } });
    if (id === "invalid") return route.fulfill({ status: 400, json: { error: { code: "INVALID_ARGUMENT" } } });
    return route.fulfill({ json: { revision: 2 } });
  });
  await openAlbum(page, origin, false);
  await detailsToggle(page).click();
  await details(page).getByRole("button", { name: "自动刮削", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText("已采用 MusicBrainz 的《complete》。");
  expect(submitted).toEqual(ids);
});

test("updating a scraped album requires confirmation for each replacement edition", async ({ page }) => {
  const state = await mock(page);
  const pluginId = "musicfs.scraper.musicbrainz";
  const releases = ["First edition", "Second edition"];
  state.saved.push({ field: "albumDetails", pluginId, item: candidate });
  state.album.revision = 7;
  const writes: { id: string; key: string }[] = [];
  await page.route("**/api/v1/library/albums/one/auto-scrape", route => route.fulfill({
    json: { items: releases.map(id => ({ id, title: id, pluginId, candidateToken: id })) },
  }));
  await page.route("**/api/v1/scrapers/musicfs.scraper.musicbrainz/search", route => {
    const id = route.request().postDataJSON().query.externalId;
    return route.fulfill({ json: { items: [{ ...completeCandidate, id, candidateToken: id + "-tracks" }] } });
  });
  await page.route("**/api/v1/library/albums/one/scraped-fields", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { items: state.saved } });
    const body = route.request().postDataJSON();
    expect(body.expectedRevision).toBe(7);
    writes.push({ id: body.candidates.albumDetails, key: route.request().headers()["idempotency-key"] });
    if (writes.length === 1) return route.fulfill({ status: 400, json: { error: { code: "INVALID_ARGUMENT" } } });
    return route.fulfill({ json: { revision: 8 } });
  });
  await openAlbum(page, origin, false);
  await detailsToggle(page).click();
  await details(page).getByRole("button", { name: "自动刮削", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "自动刮削" });
  for (const [index, title] of releases.entries()) {
    await expect(modal.getByRole("status")).toHaveText(`将采用 MusicBrainz 的《${title}》，更新已保存的平台专辑资料和曲目表。`);
    expect(writes).toHaveLength(index);
    await modal.getByRole("button", { name: "确认更新", exact: true }).click();
  }
  await expect(modal.getByRole("status")).toHaveText("已采用 MusicBrainz 的《Second edition》。");
  expect(writes.map(write => write.id)).toEqual(releases);
  expect(writes.every(write => write.key.length > 0)).toBe(true);
  expect(writes[1].key).not.toBe(writes[0].key);
});
