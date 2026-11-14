import { routeApi } from "../fixtures/control-mock";
import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import type { ContentType, Work } from "../../src/api/works";
import { playback, track } from "../fixtures/dto";
import { audioFixture } from "../fixtures/audio";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });

const types: ContentType[] = [
  { id: "music", name: "音乐专辑" },
  { id: "radio", name: "电台", library: { order: 30, icon: "radio", trackListOptional: false } },
  { id: "asmr", name: "ASMR", library: { order: 20, icon: "headphones", trackListOptional: false } },
  { id: "spoken", name: "演播作品", library: { order: 40, icon: "album", trackListOptional: false } },
  { id: "cd_album", name: "CD专辑", library: { order: 10, icon: "disc", trackListOptional: true } },
].map((type) => ({ ...type, pluginId: `example.${type.id}`, pluginVersion: "0.1.0", description: "",
  creditRoles: [], externalIdNamespaces: [], views: ["work-list", "work-detail"] }));
function work(workId: string, title: string, contentType: string): Work {
  return { workId, title, contentType, description: "按目录收藏的本地作品。", credits: [], externalIds: [], tags: ["收藏"],
    revision: 1, showInTrackList: false, createdAt: "2026-10-22T01:00:00Z", updatedAt: "2026-10-22T01:00:00Z" };
}
const works = [work("asmr", "雨夜音声", "asmr"), work("album", "钢琴数字专辑", "music"),
  work("cd", "钢琴 CD 专辑", "cd_album"), work("radio", "深夜节目", "radio"), work("spoken", "林间演播", "spoken")];

async function mockNavigation(page: Page) {
  const state = { types: [...types], lists: [] as URL[], creates: [] as unknown[], deletes: [] as string[] };
  await page.addInitScript(() => {
    const key = "musicfs:work-navigation:listener:preferences";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ theme: "dark" }));
  });
  const audio = audioFixture();
  await routeApi(page, async (route) => {
    const request = route.request(), url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    if (path.endsWith("/stream")) return route.fulfill({ contentType: "audio/wav", body: audio });
    if (path === "/health/ready") return route.fulfill({ json: { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "work-navigation" } });
    if (path === "/auth/session") return route.fulfill({ json: { csrfToken: "fixture", user: { id: "listener", role: "user" } } });
    if (path === "/me/profile") return route.fulfill({ json: { user: { id: "listener", role: "user" }, nickname: "听众" } });
    if (path === "/content-types") return route.fulfill({ json: { items: state.types } });
    if (path === "/works") {
      state.lists.push(url);
      const items = works.filter((item) => (!url.searchParams.get("contentType") || item.contentType === url.searchParams.get("contentType")) &&
        (!url.searchParams.get("q") || item.title.includes(url.searchParams.get("q")!)) &&
        (!url.searchParams.get("tag") || item.tags.includes(url.searchParams.get("tag")!)));
      return route.fulfill({ json: { items, nextAfter: null } });
    }
    if (path === "/source-tracks") return route.fulfill({ json: { items: [{ ...track, displayName: "导航测试.wav" }], nextCursor: null, libraryRevision: "1" } });
    if (path === "/playback/sessions" && request.method() === "POST") {
      state.creates.push(request.postDataJSON());
      return route.fulfill({ json: { ...playback("navigation"), outputProfile: { ...playback().outputProfile, channels: 1 } } });
    }
    if (path.startsWith("/playback/sessions/") && request.method() === "DELETE") {
      state.deletes.push(path);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: { items: [], nextCursor: null, nextAfter: null, libraryRevision: "1" } });
  });
  return state;
}
const navigation = (page: Page) => page.getByRole("navigation", { name: "主导航", exact: true });
const child = (page: Page, name: string | RegExp) => navigation(page).getByRole("link", { name, exact: typeof name === "string" });
const expand = (page: Page) => navigation(page).getByRole("button", { name: "展开作品库", exact: true }).click();
async function selected(page: Page, name: string | RegExp) {
  await expect(child(page, name)).toHaveAttribute("aria-current", "page");
  await expect(navigation(page).locator('a[aria-current="page"]')).toHaveCount(1);
}

test("the whole library row toggles without navigating and restores its state after refresh", async ({ page }, info) => {
  await mockNavigation(page);
  await page.goto(`${origin}/#/library`);
  await expect(child(page, "ASMR")).toBeHidden();
  await expect(navigation(page).getByRole("button", { name: "展开作品库", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(navigation(page).getByRole("button", { name: "展开作品库", exact: true })).toHaveJSProperty("tagName", "BUTTON");
  await expect(child(page, "作品库")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "播放 导航测试.wav", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("default-collapsed.png") });
  await navigation(page).getByRole("button", { name: "展开作品库", exact: true }).getByText("作品库", { exact: true }).click();
  await expect(child(page, "ASMR")).toBeVisible();
  await expect(child(page, "演播作品")).toBeVisible();
  await expect(child(page, "全部作品")).toHaveCount(0);
  await expect(child(page, "专辑")).toHaveCount(0);
  expect(await navigation(page).locator('#work-library-navigation a').evaluateAll((links) =>
    links.map((link) => link.getAttribute("aria-label")))).toEqual(["曲目列表", "CD专辑", "ASMR", "电台", "演播作品"]);
  await navigation(page).getByRole("button", { name: "收起作品库", exact: true }).getByText("作品库", { exact: true }).click();
  await expect(child(page, "ASMR")).toBeHidden();
  await expect(page).toHaveURL(/#\/library$/);
  await navigation(page).getByRole("button", { name: "展开作品库", exact: true }).locator("svg").last().click();
  await expect(child(page, "ASMR")).toBeVisible();
  await expect(page).toHaveURL(/#\/library$/);
  const collapse = navigation(page).getByRole("button", { name: /收起作品库/ });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/library$/);
  await expect(child(page, "ASMR")).toBeHidden();
  await expand(page);
  await expect(child(page, "ASMR")).toBeVisible();
  await page.reload();
  await expect(navigation(page).getByRole("button", { name: /收起作品库/ })).toHaveAttribute("aria-expanded", "true");
  await expect(child(page, "ASMR")).toBeVisible();
  await navigation(page).getByRole("button", { name: /收起作品库/ }).click();
  await page.reload();
  await expect(navigation(page).getByRole("button", { name: /展开作品库/ })).toHaveAttribute("aria-expanded", "false");
  await expect(child(page, "ASMR")).toBeHidden();
  const collapsedRow = navigation(page).getByRole("button", { name: "展开作品库", exact: true });
  const rowBounds = await collapsedRow.boundingBox();
  expect(rowBounds).not.toBeNull();
  await collapsedRow.click({ position: { x: rowBounds!.width * 0.65, y: rowBounds!.height / 2 } });
  await expect(child(page, "电台")).toBeVisible();
  await expect(page).toHaveURL(/#\/library$/);
  await child(page, "电台").click();
  await expect(page).toHaveURL(/#\/works\?contentType=radio$/);
  await selected(page, "电台");
  await expect(page.getByRole("group", { name: "作品分类", exact: true })).toHaveCount(0);
  await navigation(page).getByRole("button", { name: /收起作品库/ }).click();
  const expandButton = navigation(page).getByRole("button", { name: /展开作品库/ });
  await expandButton.focus();
  await page.keyboard.press("Space");
  await expect(child(page, "ASMR")).toBeVisible();
  await selected(page, "电台");
});

test("sidebar categories match query filters and retain future registered content types", async ({ page }, info) => {
  const state = await mockNavigation(page);
  await page.goto(`${origin}/#/works?contentType=asmr&q=雨&tag=收藏`);
  await expand(page);
  await selected(page, "ASMR");
  await expect.poll(() => Object.fromEntries(state.lists.at(-1)?.searchParams ?? [])).toMatchObject({ contentType: "asmr", q: "雨", tag: "收藏" });
  await child(page, "电台").click();
  await selected(page, "电台");
  await expect(page.getByRole("heading", { name: "深夜节目", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "雨夜音声", exact: true })).toHaveCount(0);
  await child(page, "CD专辑").click();
  await expect(page).toHaveURL(/#\/works\?contentType=cd_album$/);
  await selected(page, "CD专辑");
  await page.getByLabel("作品关键词", { exact: true }).fill("钢琴");
  await page.getByLabel("标签筛选", { exact: true }).fill("收藏");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect.poll(() => Object.fromEntries(state.lists.at(-1)?.searchParams ?? [])).toMatchObject({ contentType: "cd_album", q: "钢琴", tag: "收藏" });
  expect(state.lists.at(-1)?.searchParams.has("packageKind")).toBe(false);
  await expect(page.getByRole("heading", { name: "钢琴 CD 专辑", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "钢琴数字专辑", exact: true })).toHaveCount(0);
  await selected(page, "CD专辑");
  await expect(page.getByRole("group", { name: "作品分类", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("work-navigation-desktop-dark.png") });
  await child(page, "演播作品").click();
  await expect(page).toHaveURL(/#\/works\?contentType=spoken$/);
  await selected(page, "演播作品");
  await expect(page.getByRole("heading", { name: "林间演播", exact: true })).toBeVisible();
  state.types = types.filter((type) => type.id !== "cd_album");
  await page.reload();
  await expect(child(page, "CD专辑")).toHaveCount(0);
  await expect(child(page, "演播作品")).toBeVisible();
});

test("switching between tracks and work categories preserves the active player", async ({ page }) => {
  const state = await mockNavigation(page);
  await page.goto(`${origin}/#/works`);
  await expand(page);
  await child(page, "曲目列表").click();
  await selected(page, "曲目列表");
  await page.getByRole("button", { name: "播放 导航测试.wav", exact: true }).click();
  const audio = page.locator("audio");
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.1);
  const original = await audio.elementHandle();
  const before = await audio.evaluate((element: HTMLAudioElement) => ({ time: element.currentTime, src: element.currentSrc }));
  await child(page, "ASMR").click();
  await selected(page, "ASMR");
  await expect(page.getByRole("heading", { name: "雨夜音声", exact: true })).toBeVisible();
  await child(page, "曲目列表").click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByRole("button", { name: "播放 导航测试.wav", exact: true })).toBeVisible();
  expect(await original!.evaluate((element) => element === document.querySelector("audio"))).toBe(true);
  const after = await audio.evaluate((element: HTMLAudioElement) => ({ time: element.currentTime, src: element.currentSrc, paused: element.paused }));
  expect(after.src).toBe(before.src);
  expect(after.time).toBeGreaterThanOrEqual(before.time);
  expect(after.paused).toBe(false);
  expect(state.creates).toHaveLength(1);
  expect(state.deletes).toHaveLength(0);
  await expect(page.getByRole("region", { name: "播放器", exact: true })).toContainText("导航测试.wav");
});

test("removed overview and album routes return to tracks without querying mixed works", async ({ page }) => {
  const state = await mockNavigation(page);
  for (const path of ["/works", "/works?contentType=music", "/works?tag=收藏"]) {
    await page.goto(`${origin}/#${path}`);
    await expect(page).toHaveURL(/#\/library$/);
  }
  expect(state.lists).toHaveLength(0);
});

test("work navigation remains reachable at 390 pixels without horizontal overflow", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockNavigation(page);
  await page.goto(`${origin}/#/works?contentType=asmr`);
  await expand(page);
  await selected(page, "ASMR");
  const toggle = navigation(page).getByRole("button", { name: "收起作品库", exact: true });
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeInViewport();
  for (const name of ["曲目列表", "CD专辑", "ASMR", "电台", "演播作品"]) {
    const link = child(page, name);
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeInViewport();
    const bounds = await link.boundingBox();
    expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390).toBe(true);
  }
  await navigation(page).getByRole("button", { name: /收起作品库/ }).click();
  await expect(child(page, "ASMR")).toBeHidden();
  await navigation(page).getByRole("button", { name: /展开作品库/ }).click();
  await child(page, "CD专辑").click();
  await selected(page, "CD专辑");
  await child(page, "ASMR").click();
  await expect(page.getByRole("heading", { name: "雨夜音声", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("work-navigation-mobile-390.png") });
});
