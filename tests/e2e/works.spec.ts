import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import type { ContentType, Work, WorkInput } from "../../src/api/works";

let server: PreviewServer;
const origin = "http://127.0.0.1:18186";
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 18186, strictPort: true } });
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server?.httpServer.close(() => resolve()));
});

const types: ContentType[] = [
  { id: "music", name: "音乐专辑", description: "管理专辑、EP 与单曲发行，可导入 CD 抓轨或数字发行的本地音频及附带资料。", creditRoles: [{ id: "artist", name: "艺术家" }], externalIdNamespaces: [] },
  { id: "asmr", name: "音声作品", creditRoles: [{ id: "circle", name: "社团" }, { id: "voice_actor", name: "声优" }],
    externalIdNamespaces: [{ id: "dlsite", name: "作品编号" }] },
  { id: "spoken", name: "演播作品", creditRoles: [{ id: "reader", name: "朗读者" }],
    externalIdNamespaces: [{ id: "book_number", name: "书籍编号" }] },
].map((type) => ({ ...type, pluginId: `example.${type.id}`, pluginVersion: "0.1.0", description: type.description ?? "", views: ["work-list", "work-detail"] }));

function fixture(id: string, title: string, contentType = "asmr"): Work {
  return { workId: id, title, contentType, description: "雨声中的夜晚。", credits: [{ role: "circle", name: "雨夜社" }],
    externalIds: [{ namespace: "dlsite", value: "RJ123456" }], tags: ["雨声"], revision: 1,
    createdAt: "2026-10-22T01:00:00Z", updatedAt: "2026-10-22T01:00:00Z" };
}

async function mock(page: Page) {
  const state = {
    works: [fixture("one", "雨夜故事一"), fixture("two", "雨夜故事二"), fixture("music", "钢琴专辑", "music")],
    writes: [] as { method: string; key: string | undefined; body: Record<string, unknown> }[],
    lists: [] as URL[], failWrites: 0, conflict: false,
    writeGate: null as Promise<void> | null,
    replyFailure: null as "network" | "gateway" | "invalid" | null,
    replies: new Map<string, Work>(),
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    if (path === "/health/ready") return route.fulfill({ json: { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "works-test" } });
    if (path === "/auth/session") return route.fulfill({ json: { csrfToken: "work-csrf", user: { id: "listener", role: "user" } } });
    if (path === "/me/profile") return route.fulfill({ json: { user: { id: "listener", role: "user" }, nickname: "听众" } });
    if (path === "/content-types") return route.fulfill({ json: { items: types } });
    if (path === "/works" && method === "GET") {
      state.lists.push(url);
      const matches = state.works.filter((work) => (!url.searchParams.get("contentType") || work.contentType === url.searchParams.get("contentType")) &&
        (!url.searchParams.get("q") || work.title.includes(url.searchParams.get("q")!)) &&
        (!url.searchParams.get("tag") || work.tags.includes(url.searchParams.get("tag")!)));
      const start = url.searchParams.has("after") ? matches.findIndex((work) => work.workId === url.searchParams.get("after")) + 1 : 0;
      const items = matches.slice(start, start + 1);
      return route.fulfill({ json: { items, nextAfter: start + 1 < matches.length ? items[0].workId : null } });
    }
    if (path.endsWith("/packages") && method === "GET") return route.fulfill({ json: { items: [] } });
    if (path.startsWith("/works/") && method === "GET") {
      const work = state.works.find((item) => item.workId === decodeURIComponent(path.slice(7)));
      return work ? route.fulfill({ json: work }) : route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
    }
    if ((path === "/works" && method === "POST") || (path.startsWith("/works/") && method === "PUT")) {
      const body = request.postDataJSON();
      const key = request.headers()["idempotency-key"];
      state.writes.push({ method, body, key });
      if (state.writeGate) await state.writeGate;
      const previous = state.replies.get(key);
      if (previous) return route.fulfill({ json: previous });
      const reply = (work: Work, status = 200) => {
        state.replies.set(key, structuredClone(work));
        const failure = state.replyFailure;
        state.replyFailure = null;
        if (failure === "network") return route.abort("connectionfailed");
        if (failure === "gateway") return route.fulfill({ status: 502, json: { error: { code: "GATEWAY_ERROR" } } });
        if (failure === "invalid") return route.fulfill({ status, contentType: "application/json", body: "{invalid" });
        return route.fulfill({ status, json: work });
      };
      if (state.failWrites > 0) {
        state.failWrites--;
        return route.fulfill({ status: 400, json: { error: { code: "INVALID_ARGUMENT" } } });
      }
      if (method === "POST") {
        const work = { ...fixture("created", ""), ...body as WorkInput };
        state.works.push(work);
        return reply(work, 201);
      }
      const work = state.works.find((item) => item.workId === decodeURIComponent(path.slice(7)))!;
      if (state.conflict) {
        work.title = "其他窗口保存的标题";
        work.revision++;
        state.conflict = false;
        return route.fulfill({ status: 409, json: { error: { code: "CONFLICT" } } });
      }
      const { expectedRevision, ...fields } = body;
      expect(expectedRevision).toBe(work.revision);
      Object.assign(work, fields, { revision: work.revision + 1 });
      return reply(work);
    }
    return route.fulfill({ json: { items: [], nextCursor: null, nextAfter: null, libraryRevision: "1" } });
  });
  return state;
}

test("work categories preserve filters across pages and expose readable detail", async ({ page }, info) => {
  const state = await mock(page);
  await page.goto(`${origin}/#/works`);
  await page.getByRole("group", { name: "作品分类" }).getByRole("button", { name: "音声作品", exact: true }).click();
  await expect(page).toHaveURL(/contentType=asmr$/);
  await page.getByLabel("作品关键词", { exact: true }).fill("雨夜");
  await page.getByLabel("标签筛选", { exact: true }).fill("雨声");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page).toHaveURL(/q=.*&tag=/);
  await expect.poll(() => state.lists.at(-1)?.searchParams.get("tag")).toBe("雨声");
  await expect(page.getByRole("heading", { name: "雨夜故事一", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "加载更多作品" }).click();
  await expect(page.getByRole("heading", { name: "雨夜故事二", exact: true })).toBeVisible();
  const last = state.lists.at(-1)!;
  expect(Object.fromEntries(last.searchParams)).toMatchObject({ contentType: "asmr", q: "雨夜", tag: "雨声", after: "one" });
  await page.screenshot({ path: info.outputPath("works-list-desktop.png") });
  await page.getByRole("link").filter({ has: page.getByRole("heading", { name: "雨夜故事一", exact: true }) }).click();
  await expect(page.getByRole("heading", { name: "作品署名", exact: true })).toBeVisible();
  await expect(page.getByText("RJ123456", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("work-detail-mobile.png") });
});

test("creation and editing use declared metadata and stable retry keys", async ({ page }) => {
  const state = await mock(page);
  await page.goto(`${origin}/#/works`);
  await page.getByRole("button", { name: "新建作品", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建作品", exact: true });
  await dialog.getByLabel("内容类型", { exact: true }).selectOption("spoken");
  await dialog.getByLabel("作品标题", { exact: true }).fill("林间故事");
  await dialog.getByRole("button", { name: "添加署名" }).click();
  await expect(dialog.getByLabel("署名角色 1", { exact: true })).toHaveValue("reader");
  await expect(dialog.getByRole("option", { name: "朗读者", exact: true })).toHaveCount(1);
  await dialog.getByLabel("署名名称 1", { exact: true }).fill("甲读者");
  await dialog.getByRole("button", { name: "添加编号" }).click();
  await dialog.getByLabel("编号值 1", { exact: true }).fill("BOOK-1");
  await dialog.getByLabel("标签（每行一个）", { exact: true }).fill("故事\n森林");
  state.failWrites = 1;
  await dialog.getByRole("button", { name: "创建作品", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "创建作品", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林间故事", exact: true })).toBeVisible();
  expect(state.writes[0].key).toBeTruthy();
  expect(state.writes[0].key).toBe(state.writes[1].key);
  expect(state.writes[1].body).toMatchObject({ contentType: "spoken", credits: [{ role: "reader", name: "甲读者" }],
    externalIds: [{ namespace: "book_number", value: "BOOK-1" }], tags: ["故事", "森林"] });
  await page.getByRole("button", { name: "编辑作品资料", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "编辑作品资料", exact: true });
  await expect(edit.getByLabel("内容类型", { exact: true })).toBeDisabled();
  await edit.getByLabel("作品标题", { exact: true }).fill("林间故事修订");
  state.failWrites = 1;
  await edit.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(edit.getByRole("alert")).toBeVisible();
  await edit.getByLabel("作品标题", { exact: true }).fill("林间故事再修订");
  await edit.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林间故事再修订", exact: true })).toBeVisible();
  expect(state.writes[2].key).not.toBe(state.writes[3].key);
  expect(state.writes[3].body.expectedRevision).toBe(1);
  expect(state.writes[3].body).not.toHaveProperty("contentType");
});

test("conflicting updates require an explicit refresh and preserve the newer record", async ({ page }) => {
  const state = await mock(page);
  await page.goto(`${origin}/#/works/one`);
  await page.getByRole("button", { name: "编辑作品资料", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑作品资料", exact: true });
  await dialog.getByLabel("作品标题", { exact: true }).fill("过期修改");
  state.conflict = true;
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("请刷新最新资料后重新编辑");
  await expect(dialog.getByLabel("作品标题", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "刷新最新资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "其他窗口保存的标题", exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1);
});

test("finishing a submitted work after leaving does not return to the old editor", async ({ page }) => {
  const state = await mock(page);
  let finishWrite!: () => void;
  state.writeGate = new Promise<void>((resolve) => { finishWrite = resolve; });
  await page.goto(`${origin}/#/library`);
  await page.getByRole("link", { name: "作品库", exact: true }).click();
  await page.getByRole("button", { name: "新建作品", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建作品", exact: true });
  await editor.getByLabel("作品标题", { exact: true }).fill("后台完成的作品");
  await editor.getByRole("button", { name: "创建作品", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(editor).toHaveCount(0);
  const response = page.waitForResponse((value) => value.url().endsWith("/api/v1/works") && value.request().method() === "POST");
  finishWrite();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page).toHaveURL(/#\/library$/);
  expect(state.works.find((work) => work.workId === "created")?.title).toBe("后台完成的作品");
  expect(state.writes).toHaveLength(1);
});

test("uncertain committed saves lock original content and replay without duplicate writes", async ({ page }) => {
  const state = await mock(page);
  await page.goto(`${origin}/#/works`);
  for (const [index, failure] of (["network", "gateway", "invalid"] as const).entries()) {
    const editing = index > 0;
    await page.getByRole("button", { name: editing ? "编辑作品资料" : "新建作品", exact: true }).click();
    const editor = page.getByRole("dialog", { name: editing ? "编辑作品资料" : "新建作品", exact: true });
    const title = `等待确认的作品 ${index}`;
    await editor.getByLabel("作品标题", { exact: true }).fill(title);
    state.replyFailure = failure;
    const before = state.writes.length;
    await editor.getByRole("button", { name: editing ? "保存修改" : "创建作品", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("暂时无法确认保存结果");
    await expect(editor.getByLabel("作品标题", { exact: true })).toBeDisabled();
    await expect(editor.getByLabel("作品简介", { exact: true })).toBeDisabled();
    await expect(editor.getByRole("button", { name: "添加署名", exact: true })).toBeDisabled();
    await expect(editor.getByRole("button", { name: "关闭并刷新查看", exact: true })).toBeEnabled();
    expect(state.works.filter((work) => work.workId === "created")).toHaveLength(1);
    await editor.getByRole("button", { name: "重试确认保存", exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(before + 2);
    expect(state.writes[before].key).toBe(state.writes[before + 1].key);
    expect(state.writes[before].body).toEqual(state.writes[before + 1].body);
    expect(state.works.filter((work) => work.workId === "created")).toHaveLength(1);
    expect(state.works.find((work) => work.workId === "created")?.revision).toBe(index + 1);
  }
});

test("unavailable content types remain readable and retired metadata stays visible", async ({ page }) => {
  const state = await mock(page);
  state.works[0].contentType = "unavailable";
  await page.goto(`${origin}/#/works/one`);
  await expect(page.getByRole("heading", { name: "雨夜故事一", exact: true })).toBeVisible();
  await expect(page.getByText("此作品的内容类型当前不可用，已有资料可以阅读，编辑暂不可用。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑作品资料", exact: true })).toBeDisabled();
  state.works[0].contentType = "asmr";
  state.works[0].credits[0].role = "retired_role";
  state.works[0].externalIds[0].namespace = "retired_source";
  await page.reload();
  await page.getByRole("button", { name: "编辑作品资料", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑作品资料", exact: true });
  await expect(editor.getByLabel("署名角色 1", { exact: true })).toHaveValue("retired_role");
  await expect(editor.getByLabel("编号来源 1", { exact: true })).toHaveValue("retired_source");
  await expect(editor.getByText("有署名角色或编号来源已不在当前内容类型声明中，请调整或移除后保存。", { exact: true })).toBeVisible();
});
