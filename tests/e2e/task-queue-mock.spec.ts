import { test, expect } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { taskQueueMock } from "../fixtures/task-queue-mock";
import { refreshTask } from "../fixtures/tasks";
import { musicPage } from "../fixtures/music-catalog";
import { track } from "../fixtures/dto";
import { instanceIds } from "../fixtures/plugins";
import type { Task } from "../../src/api/tasks";

let server: PreviewServer;
const origin = "http://127.0.0.1:18158";
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18158, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

test("album queue submits the active source and search, retries the same request and refreshes the album list", async ({ page }) => {
  const state = await taskQueueMock(page);
  const task: Task = { ...refreshTask(), kind: "albumAutoScrape", progress: { completed: 0, total: 0 }, phase: "queued" };
  let submitted: { body: unknown; key: string } | undefined;
  await page.route("**/api/v1/tasks/album-scrape", async route => {
    const request = { body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] };
    if (!submitted) { submitted = request; return route.abort("failed"); }
    expect(request).toEqual(submitted);
    state.tasks.push(task); state.pushTasks();
    return route.fulfill({ status: 202, json: task });
  });
  await page.route("**/api/v1/library/albums?**", route => route.fulfill({ json: {
    items: task.status === "succeeded" ? [] : [{ albumId: "album", name: "Night", trackCount: 2 }], nextAfter: null,
  } }));
  const params = new URLSearchParams({ category: "专辑", source: instanceIds.local, categoryQuery: "Night", unscrapedOnly: "true" });
  await page.goto(`${origin}/#/library?${params}`);
  await expect(page.getByRole("button", { name: "Night 2 首", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "一键自动刮削", exact: true }).click();
  await page.getByRole("button", { name: "继续确认", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已加入任务队列" })).toBeVisible();
  const enqueue = page.getByRole("button", { name: "一键自动刮削", exact: true });
  await expect(enqueue).toBeDisabled();
  state.tasks.pop(); state.pushTasks();
  await expect(enqueue).toBeEnabled();
  state.tasks.push(task); state.pushTasks();
  await expect(enqueue).toBeDisabled();
  expect(submitted?.key).toBeTruthy();
  expect(submitted?.body).toEqual({ providerInstanceId: instanceIds.local, q: "Night" });
  await page.getByRole("textbox", { name: "搜索分类", exact: true }).fill("Day");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(enqueue).toBeEnabled();
  await page.getByRole("button", { name: "任务队列", exact: true }).click();
  const panel = page.getByRole("region", { name: "任务队列详情" });
  await expect(panel.getByRole("button", { name: "取消任务 专辑自动刮削" })).toBeVisible();
  Object.assign(task, { status: "running", phase: "scraping", cancellable: false, progress: { completed: 1, total: 2 } }); state.pushTasks();
  await expect(panel).toContainText("已处理 1/2 张专辑");
  Object.assign(task, { status: "succeeded", phase: "finished", result: { updated: 1, retained: 0, notFound: 1, failed: 0 } }); state.pushTasks();
  await expect(panel).toContainText("更新 1 · 保留 0 · 未找到 1 · 失败 0");
  await expect(page.getByText("没有符合条件的未刮削专辑", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "一键自动刮削", exact: true })).toBeEnabled();
});

test("bulk merge can be queued with the selected rule and reports the final result after leaving the dialog", async ({ page }) => {
  const state = await taskQueueMock(page);
  const task: Task = { ...refreshTask(), kind: "bulkMerge", phase: "queued", progress: { completed: 0, total: 0 },
    result: { mergedGroups: 0, mergedSources: 0, skippedGroups: 0 } };
  await page.route("**/api/v1/library/tracks?**", route => route.fulfill({ json: musicPage([{ ...track,
    title: task.status === "succeeded" ? "Merged track" : "Before merge" }]) }));
  await page.route("**/api/v1/matching/revision", route => route.fulfill({ json: { revision: 1 } }));
  await page.route("**/api/v1/tasks/bulk-merge", route => {
    expect(route.request().postDataJSON()).toEqual({ mode: "title_artist", expectedRevision: 1 });
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    state.tasks.push(task); state.pushTasks();
    return route.fulfill({ status: 202, json: task });
  });
  await page.goto(`${origin}/#/library`);
  await page.getByRole("button", { name: "一键合并重复音乐", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "一键合并重复音乐" });
  await dialog.getByRole("radio", { name: "合并重名重作者" }).check();
  await dialog.getByRole("button", { name: "加入任务队列" }).click();
  await expect(dialog).toContainText("已加入任务队列");
  await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
  await page.getByRole("button", { name: "任务队列", exact: true }).click();
  const panel = page.getByRole("region", { name: "任务队列详情" });
  await expect(panel).toContainText("任务等待执行");
  Object.assign(task, { status: "succeeded", phase: "finished", cancellable: false, result: { mergedGroups: 1, mergedSources: 2, skippedGroups: 3 } }); state.pushTasks();
  await expect(panel).toContainText("已合并 1 组重复音乐，涉及 2 个来源版本。");
  await expect(panel).toContainText("已跳过 3 个");
  await expect(page.getByRole("checkbox", { name: "选择 Merged track", exact: true })).toBeVisible();
});

test("waits for the first pushed snapshot even when randomUUID is unavailable on LAN HTTP", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(crypto, "randomUUID", { value: undefined }));
  const state = await taskQueueMock(page); state.holdSnapshot = true;
  await page.goto(`${origin}/#/library`);
  await page.getByRole("button", { name: "任务队列", exact: true }).click();
  await expect.poll(() => state.scopes).toEqual(["mine"]);
  const panel = page.getByRole("region", { name: "任务队列详情" });
  await expect(panel).toContainText("正在读取任务…");
  await expect(panel).not.toContainText("暂无任务");
  state.pushTasks(true);
  await expect(panel).toContainText("暂无任务");
  expect(state.httpLists).toBe(0);
});

test("idle queues stay quiet and reconcile changes on push and reconnect", async ({ page }) => {
  const state = await taskQueueMock(page);
  await page.clock.install(); await page.goto(`${origin}/#/library`);
  await page.getByRole("button", { name: "任务队列", exact: true }).click();
  const panel = page.getByRole("region", { name: "任务队列详情" });
  await expect(panel).toContainText("暂无任务");
  const idleReads = state.scopes.length;
  await page.clock.fastForward(9000);
  expect(state.scopes.length).toBe(idleReads);
  state.tasks.push(refreshTask());
  state.pushTasks();
  await expect(panel.getByRole("listitem")).toHaveCount(1);
  const reads = state.scopes.length;
  await page.clock.fastForward(9000);
  expect(state.scopes.length).toBe(reads);
  state.tasks.push(refreshTask({ id: "task-2" }));
  const sessionCheck = page.waitForRequest(request => request.url().endsWith("/auth/session"));
  state.control.disconnect();
  await sessionCheck;
  await page.clock.runFor(1000);
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  expect(state.scopes).toEqual(["mine", "mine"]);
  expect(state.httpLists).toBe(0);
});

test("refresh all enqueues one task per folder with independent keys", async ({ page }, info) => {
  const state = await taskQueueMock(page); await page.goto(`${origin}/#/settings`);
  const all = page.getByRole("button", { name: "刷新全部目录", exact: true });
  await expect(all).toHaveText("刷新"); await all.click();
  await expect.poll(() => state.posts.length).toBe(3);
  expect(state.posts.map(item => item.roots[0]).sort()).toEqual(["music", "other", "third"]);
  expect(new Set(state.posts.map(item => item.key)).size).toBe(3);
  await page.getByRole("button", { name: "任务队列", exact: true }).click();
  await expect(page.getByRole("region", { name: "任务队列详情" }).getByRole("listitem")).toHaveCount(3);
  await page.screenshot({ path: info.outputPath("task-queue-desktop-page.png"), fullPage: true });
  expect(state.configWrites).toBe(0);
});

test("running work allows other directories to join and queued tasks can be cancelled", async ({ page }) => {
  const state = await taskQueueMock(page); await page.goto(`${origin}/#/settings`);
  await page.getByRole("button", { name: "刷新目录 Music 的元数据", exact: true }).click();
  await expect.poll(() => state.tasks.length).toBe(1);
  Object.assign(state.tasks[0], { status: "running", phase: "metadata" });
  state.pushTasks();
  await page.getByRole("button", { name: "刷新目录 Other 的元数据", exact: true }).click();
  await expect.poll(() => state.tasks.length).toBe(2);
  await page.getByRole("button", { name: "任务队列", exact: true }).click();
  await page.getByRole("button", { name: "取消目录 Other 的刷新" }).click();
  const panel = page.getByRole("region", { name: "任务队列详情" });
  await expect(panel).toContainText("已取消");
  await page.getByRole("button", { name: "中断目录 Music 的刷新" }).click();
  await expect(panel.getByText("已取消", { exact: true })).toHaveCount(2);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await page.reload();
  expect(state.posts).toHaveLength(2); expect(state.cancellations).toHaveLength(2);
});

test("unknown all-folder submission retries only the unconfirmed root with its original key", async ({ page }) => {
  const state = await taskQueueMock(page); state.uncertain = "other";
  await page.goto(`${origin}/#/settings`); await page.getByRole("button", { name: "刷新全部目录", exact: true }).click();
  await expect.poll(() => state.posts.length).toBe(3);
  await expect(page.locator(".local-music-source").getByRole("button", { name: "继续确认" })).toBeVisible();
  const original = state.posts.find(item => item.roots[0] === "other")!;
  await expect(page.getByRole("button", { name: "刷新全部目录", exact: true })).toBeDisabled();
  await page.reload();
  await page.locator(".local-music-source").getByRole("button", { name: "继续确认" }).click();
  await expect.poll(() => state.posts.length).toBe(4);
  expect(state.posts[3]).toEqual(original); expect(state.tasks).toHaveLength(3);
  await expect(page.getByRole("button", { name: "刷新全部目录", exact: true })).toBeEnabled();
});

test("admin scope defaults to mine, shows owners in all, and allows cancellation", async ({ page }, info) => {
  const state = await taskQueueMock(page);
  state.tasks.push(refreshTask(), refreshTask({ id: "other-task", ownerId: "other-user", ownerName: "Bob",
    status: "running", phase: "metadata", roots: [{ id: "other", name: "Other" }], rootIds: ["other"] }));
  state.activeCount = 123;
  await page.goto(`${origin}/#/library`); const button = page.getByRole("button", { name: "任务队列", exact: true });
  await button.click(); const panel = page.getByRole("region", { name: "任务队列详情" });
  await expect(panel.getByRole("listitem")).toHaveCount(1); await expect(page.getByText("123 个任务进行中", { exact: true })).toBeAttached();
  await panel.getByRole("button", { name: "所有任务", exact: true }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(2); await expect(panel).toContainText("Bob");
  await panel.screenshot({ path: info.outputPath("task-queue-desktop.png") });
  await panel.getByRole("button", { name: "中断目录 Other 的刷新" }).click();
  await expect.poll(() => state.cancellations).toContainEqual({ id: "other-task", scope: "all" });
  await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0); await expect(button).toBeFocused();
});

test("ordinary users only request their own tasks and resume after navigation without local storage", async ({ page }) => {
  const state = await taskQueueMock(page); state.admin = false;
  state.tasks.push(refreshTask(), refreshTask({ id: "other-task", ownerId: "other-user" }));
  await page.goto(`${origin}/#/library`); await page.getByRole("button", { name: "任务队列", exact: true }).click();
  const panel = page.getByRole("region", { name: "任务队列详情" });
  await expect(panel.getByRole("listitem")).toHaveCount(1); await expect(panel.getByRole("button", { name: "所有任务" })).toHaveCount(0);
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.goto(`${origin}/#/settings`); await page.reload();
  await page.getByRole("button", { name: "任务队列", exact: true }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(1);
  expect(state.scopes.every(scope => scope === "mine")).toBe(true); expect(state.posts).toHaveLength(0);
});
