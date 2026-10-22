import { expect, test } from "@playwright/test";
import { startDirectoryServer, type DirectoryTestServer } from "./directory-server";
import { login } from "./helpers";

let server: DirectoryTestServer | undefined;

test.afterEach(async () => { await server?.stop(); server = undefined; });

test("real sessions persist local output preferences across server restarts without server DSP requests", async ({ page }, info) => {
  test.setTimeout(180_000);
  server = await startDirectoryServer();
  const initialReady = await (await page.request.get(`${server.origin}/api/v1/health/ready`)).json() as { instanceId: string };
  const dspRequests: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.includes("/dsp/settings")) dspRequests.push(request.url()); });
  await login(page, server);
  await page.goto(`${server.origin}/#/settings?tab=dsp`);
  await page.getByRole("button", { name: "输出设置", exact: true }).click();
  const layout = page.getByLabel("输出声道", { exact: true });
  const save = page.getByRole("button", { name: "保存", exact: true });
  await expect(layout).toHaveValue("source");
  await expect(page.getByLabel("立体声环绕扩展", { exact: true })).not.toBeChecked();
  await layout.selectOption("mono"); await save.click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "输出设置", exact: true }).click();
  await expect(layout).toHaveValue("mono");
  await layout.selectOption("source");
  await page.getByRole("button", { name: "撤销更改", exact: true }).click();
  await expect(layout).toHaveValue("mono");
  await server.restart();
  const restartedReady = await (await page.request.get(`${server.origin}/api/v1/health/ready`)).json() as { instanceId: string };
  expect(initialReady.instanceId).toEqual(expect.any(String));
  expect(restartedReady.instanceId).toEqual(expect.any(String));
  expect(restartedReady.instanceId).not.toBe(initialReady.instanceId);
  await page.reload();
  await page.getByRole("button", { name: "输出设置", exact: true }).click();
  await expect(layout).toHaveValue("mono");
  await expect(save).toBeDisabled();
  expect(dspRequests).toEqual([]);
  await page.screenshot({ path: info.outputPath("local-output-real-session.png") });
});
