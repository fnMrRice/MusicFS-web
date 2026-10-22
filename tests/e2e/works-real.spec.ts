import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ContentType, Work } from "../../src/api/works";
import { startDirectoryServer, type DirectoryTestServer } from "./directory-server";
import { login } from "./helpers";

let server: DirectoryTestServer | undefined;

test.afterEach(async () => { await server?.stop(); server = undefined; });

async function saveWork(page: Page, editor: Locator, id?: string) {
  const path = id ? `/api/v1/works/${encodeURIComponent(id)}` : "/api/v1/works";
  const method = id ? "PUT" : "POST";
  const [response] = await Promise.all([
    page.waitForResponse((item) => new URL(item.url()).pathname === path && item.request().method() === method),
    editor.getByRole("button", { name: id ? "保存修改" : "创建作品", exact: true }).click(),
  ]);
  expect(response.request().headers()["idempotency-key"]).toBeTruthy();
  return response;
}

async function editWork(page: Page) {
  await page.getByRole("button", { name: "编辑作品资料", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑作品资料", exact: true });
  await expect(editor.getByLabel("内容类型", { exact: true })).toBeDisabled();
  return editor;
}

test("real work lifecycle persists ASMR metadata and rejects a stale browser editor", async ({ page }, info) => {
  test.setTimeout(180_000);
  server = await startDirectoryServer();
  await login(page, server);
  const library = page.getByRole("button", { name: /^(展开|收起)作品库$/ });
  await expect(library).toBeVisible();
  if (await library.getAttribute("aria-expanded") === "false") await library.click();
  const [typesResponse] = await Promise.all([
    page.waitForResponse((item) => new URL(item.url()).pathname === "/api/v1/content-types"),
    page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "全部作品", exact: true }).click(),
  ]);
  expect(typesResponse.status(), await typesResponse.text()).toBe(200);
  const { items: contentTypes } = await typesResponse.json() as { items: ContentType[] };
  const asmr = contentTypes.find((item) => item.id === "asmr");
  expect(asmr).toMatchObject({ pluginId: "musicfs.plugin.content.asmr", name: "音声作品" });
  expect(asmr?.creditRoles).toContainEqual({ id: "voice_actor", name: "声优" });
  expect(asmr?.externalIdNamespaces.some((item) => item.id === "dlsite")).toBe(true);
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "ASMR", exact: true }).click();
  await page.getByRole("button", { name: "新建作品", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建作品", exact: true });
  await expect(create.getByLabel("内容类型", { exact: true })).toHaveValue("asmr");
  await create.getByLabel("作品标题", { exact: true }).fill("雨夜音声作品");
  await create.getByRole("textbox", { name: "作品简介", exact: true }).fill("窗边的雨声。\n含有背景音乐与无背景音乐版本。");
  await create.getByRole("button", { name: "添加署名", exact: true }).click();
  await create.getByLabel("署名角色 1", { exact: true }).selectOption("circle");
  await create.getByLabel("署名名称 1", { exact: true }).fill("雨夜社");
  await create.getByRole("button", { name: "添加署名", exact: true }).click();
  await create.getByLabel("署名角色 2", { exact: true }).selectOption("voice_actor");
  await create.getByLabel("署名名称 2", { exact: true }).fill("雨音");
  await create.getByRole("button", { name: "添加编号", exact: true }).click();
  await create.getByLabel("编号来源 1", { exact: true }).selectOption("dlsite");
  await create.getByLabel("编号值 1", { exact: true }).fill("RJ123456");
  await create.getByLabel("标签（每行一个）", { exact: true }).fill("雨声\n耳语");
  const createdResponse = await saveWork(page, create);
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const created = await createdResponse.json() as Work;
  expect(created).toMatchObject({ contentType: "asmr", title: "雨夜音声作品", revision: 1,
    credits: [{ role: "circle", name: "雨夜社" }, { role: "voice_actor", name: "雨音" }],
    externalIds: [{ namespace: "dlsite", value: "RJ123456" }], tags: ["雨声", "耳语"] });
  await expect(page).toHaveURL(`${server.origin}/#/works/${created.workId}`);
  await expect(page.getByRole("heading", { name: created.title, exact: true })).toBeVisible();
  await expect(page.getByText("声优", { exact: true })).toBeVisible();
  await expect(page.getByText("雨音", { exact: true })).toBeVisible();
  await expect(page.getByText("RJ123456", { exact: true })).toBeVisible();

  const editor = await editWork(page);
  await editor.getByLabel("作品标题", { exact: true }).fill("雨夜音声作品 · 修订");
  await editor.getByRole("textbox", { name: "作品简介", exact: true }).fill("已整理作品资料，保留两个版本的说明。");
  await editor.getByLabel("署名名称 2", { exact: true }).fill("雨音（修订）");
  const updatedResponse = await saveWork(page, editor, created.workId);
  expect(updatedResponse.status(), await updatedResponse.text()).toBe(200);
  expect(updatedResponse.request().postDataJSON()).toMatchObject({ expectedRevision: 1 });
  expect(updatedResponse.request().postDataJSON()).not.toHaveProperty("contentType");
  const updated = await updatedResponse.json() as Work;
  expect(updated).toMatchObject({ workId: created.workId, revision: 2, contentType: "asmr", createdAt: created.createdAt });
  await expect(page.getByRole("heading", { name: updated.title, exact: true })).toBeVisible();

  // 关闭并重启真实服务端，排除仅停留在浏览器缓存或服务端内存的结果。
  await server.restart();
  await page.reload();
  await expect(page.getByRole("heading", { name: updated.title, exact: true })).toBeVisible();
  await expect(page.getByText("雨音（修订）", { exact: true })).toBeVisible();
  const workURL = `${server.origin}/api/v1/works/${created.workId}`;
  const persistedResponse = await page.request.get(workURL);
  expect(persistedResponse.status(), await persistedResponse.text()).toBe(200);
  expect(await persistedResponse.json()).toEqual(updated);
  await page.screenshot({ path: info.outputPath("works-real-persisted.png"), fullPage: true });

  // 两个真实页面持有同一修订，后一页面先保存，前一页面必须得到真实 409。
  const staleEditor = await editWork(page);
  await staleEditor.getByLabel("作品标题", { exact: true }).fill("不应覆盖新资料的过期修改");
  const other = await page.context().newPage();
  await other.goto(`${server.origin}/#/works/${created.workId}`);
  const otherEditor = await editWork(other);
  await otherEditor.getByLabel("作品标题", { exact: true }).fill("另一个窗口保存的最新作品资料");
  const winnerResponse = await saveWork(other, otherEditor, created.workId);
  expect(winnerResponse.status(), await winnerResponse.text()).toBe(200);
  const winner = await winnerResponse.json() as Work;
  expect(winner).toMatchObject({ workId: created.workId, revision: 3, title: "另一个窗口保存的最新作品资料" });
  await expect(other.getByRole("heading", { name: winner.title, exact: true })).toBeVisible();
  await other.close();
  const conflict = await saveWork(page, staleEditor, created.workId);
  expect(conflict.status(), await conflict.text()).toBe(409);
  expect(conflict.request().postDataJSON()).toMatchObject({ expectedRevision: 2 });
  expect(await conflict.json()).toMatchObject({ error: { code: "CONFLICT" } });
  await expect(staleEditor.getByRole("alert")).toContainText("请刷新最新资料后重新编辑");
  await expect(staleEditor.getByLabel("作品标题", { exact: true })).toBeDisabled();
  const afterConflict = await page.request.get(workURL);
  expect(afterConflict.status(), await afterConflict.text()).toBe(200);
  expect(await afterConflict.json()).toEqual(winner);
  await page.screenshot({ path: info.outputPath("works-real-conflict.png"), fullPage: true });
  await staleEditor.getByRole("button", { name: "刷新最新资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: winner.title, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: winner.title, exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("works-real-refreshed.png"), fullPage: true });
  await info.attach("works-real-results", {
    body: JSON.stringify({ contentTypes, created, updated, winner, conflictStatus: conflict.status() }, null, 2),
    contentType: "application/json",
  });
});
