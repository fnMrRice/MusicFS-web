import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { packageFixture, packageText } from "../fixtures/work-packages";
import { mockPackages } from "./work-packages-mock";

let server: PreviewServer;
const origin = "http://127.0.0.1:18187";
test.beforeAll(async () => { server = await preview({ preview: { host: "127.0.0.1", port: 18187, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>((resolve) => server?.httpServer.close(() => resolve())); });
async function openPreview(page: Page) {
  await page.getByRole("button", { name: "导入本地副本", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入本地副本", exact: true });
  await dialog.getByRole("button", { name: "进入目录 RJ123456 雨夜", exact: true }).click();
  await dialog.getByRole("button", { name: "预览当前目录", exact: true }).click();
  await expect(dialog.getByText("4 个目录 · 4 条音轨 · 4 个附件", { exact: true })).toBeVisible();
  return dialog;
}

test("package directory selection previews before importing and directory playback stays in its version", async ({ page }, info) => {
  const state = await mockPackages(page);
  await page.goto(`${origin}/#/works/one`);
  await page.getByRole("button", { name: "导入本地副本", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "导入本地副本", exact: true });
  await picker.getByRole("button", { name: "进入目录 RJ123456 雨夜", exact: true }).click();
  await picker.getByRole("button", { name: "进入目录 WAV", exact: true }).click();
  await expect(picker.getByText("此目录没有子目录，可以直接预览当前目录。", { exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "上一级目录", exact: true }).click();
  await picker.getByRole("button", { name: "预览当前目录", exact: true }).click();
  await expect(picker.getByText("请在确认前核对版本目录。", { exact: true })).toBeVisible();
  await expect(picker.getByText("02.wav", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
  expect(state.previews).toEqual([{ providerInstanceId: "local", rootId: "root", path: "RJ123456 雨夜", kind: "directory" }]);
  expect(state.directories.some((url) => url.searchParams.get("path") === "RJ123456 雨夜/WAV")).toBe(true);
  await picker.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByLabel("选择本地副本", { exact: true })).toHaveValue("package-one");
  await expect(page.getByRole("list", { name: "副本目录", exact: true })).not.toContainText(/pcm_s16le|audio\/wav|text\/plain|application\//);
  await expect(page.getByText("WAV · 00:30", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "播放音轨 失效.mp3", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "收起目录 WAV", exact: true }).click();
  await expect(page.getByText("02.wav", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "展开目录 WAV", exact: true }).click();
  await page.getByRole("button", { name: "目录 WAV 加入队列", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已将 2 条音轨加入队列。" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("work-package-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("list", { name: "副本目录", exact: true }).evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: info.outputPath("work-package-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "播放目录 WAV", exact: true }).click();
  await expect.poll(() => state.play.length).toBe(1);
  expect(state.play[0]).toMatchObject({ sourceTrackId: "track-WAV/01.wav" });
});

test("attachments render safe images and literal UTF8 text while large and other files stay downloads", async ({ page }) => {
  const state = await mockPackages(page); state.packages = [packageFixture()];
  const image = state.packages[0].nodes.find((node) => node.name === "封面.png")!;
  state.packages[0].nodes.push({ ...image, nodeId: "封面.webp", path: "封面.webp", name: "封面.webp", mime: "image/webp" });
  await page.goto(`${origin}/#/works/one`);
  await page.getByRole("button", { name: "查看附件 说明.txt", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "附件：说明.txt", exact: true });
  await expect(dialog.locator("pre")).toHaveText(packageText);
  expect(await page.evaluate(() => (window as unknown as { attachmentExecuted?: boolean }).attachmentExecuted)).toBeUndefined();
  await expect(dialog.getByRole("link", { name: "下载附件", exact: true })).toHaveAttribute("href", /attachments\/%E8%AF%B4%E6%98%8E.txt\?download=1$/);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "查看附件 封面.png", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "附件：封面.png", exact: true });
  await expect.poll(() => dialog.getByRole("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  for (const name of ["原始文档.pdf", "大文本.txt", "封面.webp"]) {
    await page.getByRole("button", { name: `查看附件 ${name}`, exact: true }).click();
    dialog = page.getByRole("dialog", { name: `附件：${name}`, exact: true });
    await expect(dialog.getByText("此附件不提供页面预览，可以下载后查看。", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "下载附件", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  }
  expect(state.attachments).toEqual(["说明.txt", "封面.png"]);
});

test("uncertain committed imports reuse the preview and key and stale previews require an explicit rescan", async ({ page }) => {
  const state = await mockPackages(page);
  await page.goto(`${origin}/#/works/one`);
  for (const failure of ["network", "gateway", "invalid"] as const) {
    const dialog = await openPreview(page); state.failure = failure;
    const before = state.writes.length;
    await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("暂时无法确认导入结果");
    await expect(dialog.getByLabel("副本类型", { exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "返回选择目录", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "重试确认导入", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.writes[before]).toEqual(state.writes[before + 1]);
    expect(state.writes[before].key).toBeTruthy();
    expect(state.packages).toHaveLength(1);
  }
  const dialog = await openPreview(page); state.failure = "conflict";
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("请重新预览后确认");
  await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toHaveCount(0);
  state.failPreview = true;
  await dialog.getByRole("button", { name: "重新预览", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "重新预览", exact: true }).click();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes.at(-1)?.key).not.toBe(state.writes.at(-2)?.key);
  expect(state.writes.at(-1)?.body).not.toEqual(state.writes.at(-2)?.body);
});

test("CD entry opens once and changing or reimporting copy kind requires a fresh preview", async ({ page }) => {
  const state = await mockPackages(page, "cd_album");
  await page.goto(`${origin}/#/works/one?contentType=cd_album&import=1`);
  const dialog = page.getByRole("dialog", { name: "导入本地副本", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/#\/works\/one\?contentType=cd_album$/);
  await expect(dialog.getByLabel("副本类型", { exact: true })).toHaveValue("cd_dump");
  await dialog.getByRole("button", { name: "进入目录 RJ123456 雨夜", exact: true }).click();
  await dialog.getByRole("button", { name: "预览当前目录", exact: true }).click();
  await expect(dialog.getByText("副本类型：CD 抓轨", { exact: true })).toBeVisible();
  await dialog.getByLabel("副本类型", { exact: true }).selectOption("directory");
  await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "预览当前目录", exact: true }).click();
  await expect(dialog.getByText("副本类型：普通目录", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.previews.map((preview) => preview.kind)).toEqual(["cd_dump", "directory"]);
  expect(state.writes[0].body).toEqual({ previewId: "preview-2" });
  expect(state.directories.every((url) => !url.searchParams.has("kind"))).toBe(true);
  await expect(page.getByRole("button", { name: "导入 CD 抓轨", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新导入", exact: true }).click();
  await expect(dialog.getByLabel("副本类型", { exact: true })).toHaveValue("directory");
  await expect(dialog.getByText("当前目录：RJ123456 雨夜", { exact: true })).toBeVisible();
  await dialog.getByLabel("副本类型", { exact: true }).selectOption("cd_dump");
  await dialog.getByRole("button", { name: "预览当前目录", exact: true }).click();
  await expect(dialog.getByText("此位置已导入，确认后将更新原副本及其类型。", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("选择本地副本", { exact: true }).locator("option")).toHaveText("CD 抓轨 · RJ123456 雨夜 · RJ123456 雨夜");
  expect(state.packages).toHaveLength(1);
  expect(state.packages[0]).toMatchObject({ packageId: "package-one", kind: "cd_dump", revision: 2 });
  await page.reload();
  await expect(page.getByRole("button", { name: "导入 CD 抓轨", exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("link", { name: "返回作品库", exact: true })).toHaveAttribute("href", "#/works?contentType=cd_album");
});

test("closing an unknown import refreshes packages and completing after navigation does not change the route", async ({ page }) => {
  const state = await mockPackages(page);
  await page.goto(`${origin}/#/works/one`);
  const first = await openPreview(page); state.failure = "network";
  await first.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(first.getByRole("alert")).toContainText("暂时无法确认导入结果");
  await first.getByRole("button", { name: "关闭并刷新查看", exact: true }).click();
  await expect(page.getByLabel("选择本地副本", { exact: true })).toHaveValue("package-one");
  const dialog = await openPreview(page);
  let release!: () => void; state.gate = new Promise<void>((resolve) => { release = resolve; });
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(2);
  await page.evaluate(() => { location.hash = "/library"; });
  await expect(dialog).toHaveCount(0);
  const response = page.waitForResponse((value) => value.url().endsWith("/packages") && value.request().method() === "POST");
  release(); await (await response).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page).toHaveURL(/#\/library$/);
  expect(state.packages[0].revision).toBe(2);
});
