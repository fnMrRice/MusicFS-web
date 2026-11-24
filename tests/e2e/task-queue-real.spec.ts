import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { instanceIds } from "../fixtures/plugins";
import { startDirectoryServer } from "./directory-server";
import { login, scanRequest } from "./helpers";

test("the real server pushes a refresh submitted outside the open task panel", async ({ page }) => {
  test.setTimeout(180_000);
  const server = await startDirectoryServer();
  try {
    const completed = new Set<string>();
    const taskReads: string[] = [];
    page.on("request", request => {
      if (request.method() === "GET" && new URL(request.url()).pathname === "/api/v1/tasks") taskReads.push(request.url());
    });
    page.on("websocket", socket => {
      if (!socket.url().endsWith("/api/v1/control")) return;
      socket.on("framereceived", ({ payload }) => {
        const frame = JSON.parse(String(payload));
        if (frame.type === "event" && frame.event === "tasks.snapshot")
          for (const task of frame.data.page.items) if (task.status === "succeeded") completed.add(task.id);
      });
    });
    await login(page, server);
    const api = page.request, base = server.origin + "/api/v1";
    const session = await (await api.get(base + "/auth/session")).json();
    const headers = { Origin: server.origin, "X-CSRF-Token": session.csrfToken };
    const configPath = `${base}/admin/plugin-instances/${instanceIds.local}/configuration`;
    const config = await (await api.get(configPath)).json();
    const path = join(server.allowedRoot, "Push test folder");
    mkdirSync(path);
    const saved = await api.put(configPath, {
      headers: { ...headers, "If-Match": config.revision, "Idempotency-Key": crypto.randomUUID() },
      data: { musicRoots: [{ id: "push-test", name: "Push test folder", path, importDefaults: config.importOptions.importDefaults }] },
    });
    expect(saved.status()).toBe(202);
    const operation = await saved.json();
    await expect.poll(async () => (await (await api.get(base + "/admin/plugin-operations/" + operation.operationId)).json()).status).toBe("succeeded");

    await page.getByRole("button", { name: "任务队列", exact: true }).click();
    const panel = page.getByRole("region", { name: "任务队列详情" });
    await expect(panel).toContainText("暂无任务");
    const submitted = await api.post(`${base}/provider-instances/${instanceIds.local}/scan-jobs`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { ...await scanRequest(api, server.origin), options: { refreshMetadata: true } },
    });
    expect(submitted.status()).toBe(202);
    const { jobId } = await submitted.json();
    const task = panel.getByRole("listitem").filter({ hasText: "Push test folder" });
    await expect(task).toContainText("刷新完成");
    expect(completed.has(jobId)).toBe(true);
    await page.getByRole("button", { name: "任务队列", exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "任务队列", exact: true }).click();
    await expect(panel).toContainText("刷新完成");
    expect(taskReads).toEqual([]);
  } finally {
    await server.stop();
  }
});

test("the real server completes queued album scraping and bulk merge from their library entries", async ({ page }) => {
  test.setTimeout(180_000);
  const server = await startDirectoryServer();
  try {
    await login(page, server);
    const params = new URLSearchParams({ category: "专辑", source: instanceIds.local, categoryQuery: "No matching album" });
    await page.goto(`${server.origin}/#/library?${params}`);
    const [scrape] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/tasks/album-scrape") && response.request().method() === "POST"),
      page.getByRole("button", { name: "一键自动刮削", exact: true }).click(),
    ]);
    expect(scrape.status(), await scrape.text()).toBe(202);
    expect(scrape.request().postDataJSON()).toEqual({ providerInstanceId: instanceIds.local, q: "No matching album" });
    const scrapeId = (await scrape.json()).id;

    await page.getByRole("button", { name: "全部曲目", exact: true }).click();
    await page.getByRole("button", { name: "一键合并重复音乐", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "一键合并重复音乐" });
    await dialog.getByRole("radio", { name: "合并重名重作者" }).check();
    const [merge] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/tasks/bulk-merge") && response.request().method() === "POST"),
      dialog.getByRole("button", { name: "加入任务队列", exact: true }).click(),
    ]);
    expect(merge.status(), await merge.text()).toBe(202);
    const mergeId = (await merge.json()).id;
    expect(mergeId).not.toBe(scrapeId);
    await expect(dialog).toContainText("已加入任务队列");
    await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
    await page.reload();
    await page.getByRole("button", { name: "任务队列", exact: true }).click();
    const panel = page.getByRole("region", { name: "任务队列详情" });
    const album = panel.locator(`[data-task-id="${scrapeId}"]`);
    await expect(album).toContainText("专辑自动刮削");
    await expect(album).toContainText("已完成");
    await expect(album).toContainText("更新 0 · 保留 0 · 未找到 0 · 失败 0");
    const tracks = panel.locator(`[data-task-id="${mergeId}"]`);
    await expect(tracks).toContainText("一键合并重复音乐");
    await expect(tracks).toContainText("没有可合并的重复音乐。");
  } finally {
    await server.stop();
  }
});
