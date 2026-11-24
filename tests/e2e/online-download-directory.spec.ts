import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { routeApi } from "../fixtures/control-mock";

let server: PreviewServer;
let origin: string;
const defaultPath = "/srv/musicfs/cache/playback/online";
const customPath = "/home/music/离线音乐";

test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Missing preview address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

async function setup(page: Page, role: "admin" | "user") {
  let path = "";
  const requests: string[] = [];
  await routeApi(page, route => {
    const request = route.request();
    const routePath = new URL(request.url()).pathname;
    if (routePath.endsWith("/health/ready")) return route.fulfill({
      json: { product: "MusicFS", ready: true, serverVersion: "1", apiVersion: "1", instanceId: "directory-test" },
    });
    if (routePath.endsWith("/auth/session")) return route.fulfill({ json: { csrfToken: "fixture", user: { id: "listener", role } } });
    if (routePath.endsWith("/admin/online-download-directory")) {
      requests.push(request.method());
      if (request.method() === "PUT") {
        expect(request.headers()["x-csrf-token"]).toBe("fixture");
        const next = request.postDataJSON().path;
        if (next === "relative") return route.fulfill({
          status: 400, json: { error: { code: "INVALID_ARGUMENT", message: "Absolute path required" } },
        });
        expect([customPath, ""]).toContain(next);
        path = next;
      }
      return route.fulfill({ json: { path, effectivePath: path ? path + "/MusicFS-downloads" : defaultPath } });
    }
    return route.fulfill({ json: { items: [], nextCursor: null, libraryRevision: "1" } });
  });
  await page.goto(origin + "/#/settings?tab=playback");
  return requests;
}

test("admin saves, reloads and resets the online download directory", async ({ page }) => {
  const requests = await setup(page, "admin");
  const card = page.getByRole("region", { name: "在线音乐下载目录" });
  const field = card.getByLabel("服务器上的绝对路径");
  const save = card.getByRole("button", { name: "保存设置" });
  const reset = card.getByRole("button", { name: "恢复默认目录" });
  await expect(card.getByText(defaultPath, { exact: true })).toBeVisible();
  await expect(reset).toBeDisabled();
  await field.fill("relative");
  await save.click();
  await expect(card.getByRole("alert")).toContainText("请填写服务器上可写的绝对目录路径。");
  await expect(field).toHaveValue("relative");
  await expect(card.getByText(defaultPath, { exact: true })).toBeVisible();
  await field.fill(customPath);
  await save.click();
  await expect(card.getByRole("status")).toHaveText("设置已保存。");
  await expect(save).toBeDisabled();
  await expect(card.getByText(customPath + "/MusicFS-downloads", { exact: true })).toBeVisible();
  await page.reload();
  await expect(field).toHaveValue(customPath);
  await reset.click();
  await expect(field).toHaveValue("");
  await expect(card.getByText(defaultPath, { exact: true })).toBeVisible();
  await expect(reset).toBeDisabled();
  expect(requests.filter(method => method === "PUT")).toHaveLength(3);
});

test("listener cannot read or change the server download directory", async ({ page }) => {
  const requests = await setup(page, "user");
  await expect(page.getByRole("checkbox", { name: /强制服务端转码/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "在线音乐下载目录" })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});
