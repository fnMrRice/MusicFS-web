import { test, expect } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { taskQueueMock } from "../fixtures/task-queue-mock";
import { refreshTask } from "../fixtures/tasks";

let server: PreviewServer;
const origin = "http://127.0.0.1:18158";
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18158, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

test("idle queues stay quiet and reconcile changes on push and reconnect", async ({ page }) => {
  const state = await taskQueueMock(page);
  await page.clock.install(); await page.goto(`${origin}/#/library`);
  await page.getByRole("button", { name: "任务队列", exact: true }).click();
  const panel = page.getByRole("region", { name: "任务队列详情" });
  await expect(panel).toContainText("暂无刷新任务");
  const idleReads = state.scopes.length;
  await page.clock.fastForward(9000);
  expect(state.scopes.length).toBe(idleReads);
  state.tasks.push(refreshTask());
  state.control.event("activity.changed", { resources: ["tasks"] });
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
  state.control.event("activity.changed", { resources: ["tasks"] });
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
