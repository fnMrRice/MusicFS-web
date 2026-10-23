import { waitControlResponse } from "../fixtures/control-probe";
import { expect, test, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { PackageKind, PackagePreview, WorkPackage } from "../../src/api/work-packages";
import { packagePNG, packageText } from "../fixtures/work-packages";
import { instanceIds } from "../fixtures/plugins";
import { startDirectoryServer, type DirectoryTestServer } from "./directory-server";
import { login, waitPlaying } from "./helpers";

let server: DirectoryTestServer | undefined;
test.afterEach(async () => { await server?.stop(); server = undefined; });

async function addRoot(page: Page, server: DirectoryTestServer) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "添加本地目录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加本地目录", exact: true });
  await dialog.getByRole("button", { name: `展开目录 ${basename(server.allowedRoot)}`, exact: true }).click();
  await dialog.getByRole("checkbox", { name: `选择目录 ${basename(server.selectedRoot)}`, exact: true }).check();
  await dialog.getByRole("button", { name: "添加所选目录", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => {
    const value = await (await page.request.get(`${server.origin}/api/v1/provider-instances`)).json();
    return value.items.find((item: { id: string }) => item.id === instanceIds.local)?.availability;
  }).toBe("available");
}
async function importPackage(page: Page, workId: string, kind: PackageKind = "directory", reimport = false) {
  await page.getByRole("button", { name: reimport ? "重新导入" : "导入本地副本", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入本地副本", exact: true });
  if (!reimport) await dialog.getByRole("button", { name: "进入目录 RJ123456 雨夜", exact: true }).click();
  await dialog.getByLabel("副本类型", { exact: true }).selectOption(kind);
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url().endsWith(`/works/${workId}/package-previews`)),
    dialog.getByRole("button", { name: "预览当前目录", exact: true }).click(),
  ]);
  expect(response.status(), await response.text()).toBe(200);
  const preview = await response.json() as PackagePreview;
  expect(response.request().postDataJSON().kind).toBe(kind);
  expect(preview.package.kind).toBe(kind);
  await expect(dialog.getByText("02.wav", { exact: true })).toBeVisible();
  const [confirmed] = await Promise.all([
    page.waitForResponse((item) => item.url().endsWith(`/works/${workId}/packages`) && item.request().method() === "POST"),
    dialog.getByRole("button", { name: "确认导入", exact: true }).click(),
  ]);
  expect(confirmed.status(), await confirmed.text()).toBe(200);
  expect(confirmed.request().headers()["idempotency-key"]).toBeTruthy();
  expect(confirmed.request().postDataJSON()).toEqual({ previewId: preview.previewId });
  await expect(dialog).toHaveCount(0);
  return { preview, value: await confirmed.json() as WorkPackage };
}

test("real package import preserves nested tracks and attachment bytes through reimport and restart", async ({ page }, info) => {
  test.setTimeout(240_000);
  server = await startDirectoryServer();
  const packageRoot = join(server.selectedRoot, "RJ123456 雨夜");
  for (const folder of ["WAV/特典", "另一个版本"]) mkdirSync(join(packageRoot, folder), { recursive: true });
  const wave = resolve(import.meta.dirname, "../../../server/tests/testdata/audio/markers.wav");
  for (const name of ["WAV/01.wav", "WAV/特典/02.wav", "另一个版本/01.wav"]) copyFileSync(wave, join(packageRoot, name));
  writeFileSync(join(packageRoot, "封面.png"), packagePNG);
  writeFileSync(join(packageRoot, "说明.txt"), packageText);
  writeFileSync(join(packageRoot, "原始文档.pdf"), "%PDF-1.4\nPackage fixture\n%%EOF");
  await login(page, server);
  await addRoot(page, server);
  const session = await (await page.request.get(`${server.origin}/api/v1/auth/session`)).json();
  const created = await page.request.post(`${server.origin}/api/v1/works`, {
    headers: { Origin: server.origin, "X-CSRF-Token": session.csrfToken, "Idempotency-Key": crypto.randomUUID() },
    data: { contentType: "asmr", title: "雨夜本地音声包", description: "两个版本与嵌套特典。", credits: [{ role: "circle", name: "雨夜社" }], externalIds: [], tags: [] },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { workId } = await created.json();
  await page.goto(`${server.origin}/#/works/${workId}`);
  const first = await importPackage(page, workId);
  expect(first.preview.counts).toEqual({ directories: 4, audio: 3, attachments: 3 });
  expect(first.value).toMatchObject({ workId, kind: "directory", revision: 1, relativePath: "RJ123456 雨夜" });
  const beforeCD = await page.request.get(`${server.origin}/api/v1/works?packageKind=cd_dump`);
  expect(beforeCD.status()).toBe(200);
  expect((await beforeCD.json()).items).toEqual([]);
  expect(first.value.nodes).toHaveLength(10);
  expect(first.value.nodes.filter((node) => node.kind === "audio").every((node) => node.track?.availability === "available" && !!node.sourceTrackId && !!node.assetId)).toBe(true);
  await expect(page.getByLabel("选择本地副本", { exact: true })).toHaveValue(first.value.packageId);
  await page.getByRole("button", { name: "目录 WAV 加入队列", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已将 2 条音轨加入队列。" })).toBeVisible();
  const [playback] = await Promise.all([
    waitControlResponse(page, (item) => item.url().endsWith("/playback/sessions") && item.request().method() === "POST"),
    page.getByRole("button", { name: "播放目录 WAV", exact: true }).click(),
  ]);
  expect(playback.status(), await playback.text()).toBe(201);
  expect(playback.request().postDataJSON().sourceTrackId).toBe(first.value.nodes.find((node) => node.path === "WAV/01.wav")?.sourceTrackId);
  await waitPlaying(page);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "查看附件 说明.txt", exact: true }).click();
  let attachment = page.getByRole("dialog", { name: "附件：说明.txt", exact: true });
  await expect(attachment.locator("pre")).toHaveText(packageText);
  expect(await page.evaluate(() => (window as unknown as { attachmentExecuted?: boolean }).attachmentExecuted)).toBeUndefined();
  const textURL = await attachment.getByRole("link", { name: "下载附件", exact: true }).getAttribute("href");
  const downloadedText = await page.request.get(server.origin + textURL);
  expect(downloadedText.status()).toBe(200);
  expect(downloadedText.headers()["content-disposition"]).toContain("attachment");
  expect(await downloadedText.text()).toBe(packageText);
  await attachment.getByRole("button", { name: "关闭", exact: true }).click();
  const [image] = await Promise.all([
    page.waitForResponse((item) => item.url().includes("/attachments/") && !item.url().includes("download=1")),
    page.getByRole("button", { name: "查看附件 封面.png", exact: true }).click(),
  ]);
  expect(image.status()).toBe(200);
  const directImage = await page.request.get(image.url());
  expect(directImage.status()).toBe(200);
  expect(await directImage.body()).toEqual(packagePNG);
  attachment = page.getByRole("dialog", { name: "附件：封面.png", exact: true });
  await expect.poll(() => attachment.getByRole("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await attachment.getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: info.outputPath("work-package-real-imported.png"), fullPage: true });

  // 修改真实文件后重复导入同一位置并变更副本类型，应更新原副本而非新建记录。
  const revisedText = `${packageText}\n第二次导入的说明。`;
  writeFileSync(join(packageRoot, "说明.txt"), revisedText);
  copyFileSync(wave, join(packageRoot, "WAV", "03.wav"));
  const second = await importPackage(page, workId, "cd_dump", true);
  expect(second.preview.counts.audio).toBe(4);
  expect(second.value).toMatchObject({ packageId: first.value.packageId, kind: "cd_dump", revision: 2 });
  const afterCD = await page.request.get(`${server.origin}/api/v1/works?packageKind=cd_dump`);
  expect(afterCD.status()).toBe(200);
  expect((await afterCD.json()).items.map((work: { workId: string }) => work.workId)).toEqual([workId]);
  await expect(page.getByLabel("选择本地副本", { exact: true }).locator("option")).toHaveCount(1);
  await expect(page.getByText("03.wav", { exact: true })).toBeVisible();
  await server.restart();
  await page.reload();
  await expect(page.getByText("03.wav", { exact: true })).toBeVisible();
  const persisted = await page.request.get(`${server.origin}/api/v1/works/${workId}/packages`);
  expect(persisted.status(), await persisted.text()).toBe(200);
  const saved = await persisted.json() as { items: WorkPackage[] };
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0]).toMatchObject({ packageId: first.value.packageId, kind: "cd_dump", revision: 2, workId });
  expect(saved.items[0].nodes.find((node) => node.path === "WAV/03.wav")?.track?.availability).toBe("available");
  await page.getByRole("button", { name: "查看附件 说明.txt", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "附件：说明.txt", exact: true }).locator("pre")).toHaveText(revisedText);
  await info.attach("work-package-real-results", { body: JSON.stringify({ first, second, persisted: saved }, null, 2), contentType: "application/json" });
});
