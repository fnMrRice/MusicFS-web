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
    const changed = new Set<string>();
    page.on("websocket", socket => {
      if (!socket.url().endsWith("/api/v1/control")) return;
      socket.on("framereceived", ({ payload }) => {
        const frame = JSON.parse(String(payload));
        if (frame.type === "event" && frame.event === "activity.changed")
          for (const resource of frame.data.resources) changed.add(resource);
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
    await expect(panel).toContainText("暂无刷新任务");
    const submitted = await api.post(`${base}/provider-instances/${instanceIds.local}/scan-jobs`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { ...await scanRequest(api, server.origin), options: { refreshMetadata: true } },
    });
    expect(submitted.status()).toBe(202);
    const task = panel.getByRole("listitem").filter({ hasText: "Push test folder" });
    await expect(task).toContainText("刷新完成");
    expect(changed.has("tasks")).toBe(true);
    expect(changed.has("scans")).toBe(true);
  } finally {
    await server.stop();
  }
});
