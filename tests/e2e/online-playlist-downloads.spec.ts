import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { preview, type PreviewServer } from "vite";
import type { DownloadJob, DownloadRequest } from "../../src/api/online-downloads";
import { routeApi } from "../fixtures/control-mock";
import { deferred } from "../fixtures/dto";
import { instanceIds, neteasePlugin } from "../fixtures/plugins";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Missing preview address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

const instance = instanceIds.netease;
const base = `/api/v1/online-instances/${instance}`;
const locationOf = (playlist: string) => `${origin}/#/discover/${instance}/${playlist}`;
const firstSong = { externalId: "1", title: "山色", artists: [], durationMs: 30_000 };
const secondSong = { ...firstSong, externalId: "2", title: "海潮" };
const version = { versionId: "a".repeat(64), quality: "standard", mime: "audio/mpeg", container: "mp3", codec: "mp3",
  sizeBytes: 32_000, bitrateBps: 128_000, downloadedAt: "2026-11-23T00:00:00Z" };

async function fixture(page: Page) {
  const more = deferred<void>();
  const created: { body: DownloadRequest; key: string; csrf: string }[] = [];
  const jobs = new Map<string, DownloadJob>();
  const reads: string[] = [], detailReads: string[] = [];
  const sideEffects: string[] = [];
  const state = { qualityError: false, firstSubmitError: false, account: "listener-account", playable: true,
    qualities: ["standard", "lossless"], platform: "netease", complete: true, externalIds: ["1", "missing", "1", "2"] };
  const control = await routeApi(page, async route => {
    const req = route.request();
    const { pathname, searchParams } = new URL(req.url());
    let json: unknown = { items: [], nextCursor: null, nextAfter: null };
    if (pathname.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "download-test" };
    if (pathname.endsWith("/auth/session")) json = { csrfToken: "test-csrf", user: { id: "listener", role: "user" } };
    if (pathname.endsWith("/online-instances")) json = { items: [{
      instanceId: instance, name: "Fixture", accountId: state.account, accountRevision: "revision-1", availability: "available",
      platform: state.platform, plugin: neteasePlugin, capabilities: [{ name: "stream.resolve", supported: state.playable, reason: "" }],
    }] };
    if (pathname.startsWith(base + "/playlists/")) {
      const externalId = pathname.split("/")[6];
      const playlist = { externalId, title: externalId === "mix" ? "午后" : "夜晚", trackCount: state.externalIds.length, coverUrl: null, sourceUrl: "" };
      if (!pathname.endsWith("/tracks")) json = { playlist, complete: state.complete, observedAt: "2026-11-23T00:00:00Z",
        entries: state.externalIds.map((externalTrackId, position) => ({ externalTrackId, position })) };
      else {
        const offset = Number(searchParams.get("cursor") ?? 0);
        if (offset) await more.promise;
        const items = state.externalIds.slice(offset, offset + 2).map((externalId, index) => {
          const track = externalId === "missing" || externalId.startsWith("unavailable:") ? null
            : externalId === "1" ? firstSong : externalId === "2" ? secondSong : { ...firstSong, externalId, title: externalId };
          return { externalId, track, position: offset + index, errorCode: track ? null : "NOT_FOUND" };
        });
        json = { playlist, complete: true, items, nextCursor: offset + 2 < state.externalIds.length ? String(offset + 2) : null };
      }
    }
    if (pathname === base + "/download-qualities") {
      if (state.qualityError) return route.fulfill({ status: 503, json: { error: { code: "TEMPORARY_FAILURE" } } });
      json = { defaultQuality: state.qualities[0], options: state.qualities.map(value => ({ value, label: value || "Default",
        localizedLabels: { zh: value === "standard" ? "标准" : value === "lossless" ? "无损" : "来源默认" } })) };
    }
    if (pathname === base + "/download-jobs" && req.method() === "POST") {
      const body: DownloadRequest = req.postDataJSON();
      created.push({ body, key: req.headers()["idempotency-key"], csrf: req.headers()["x-csrf-token"] });
      if (state.firstSubmitError) {
        state.firstSubmitError = false;
        return route.fulfill({ status: 503, json: { error: { code: "TEMPORARY_FAILURE" } } });
      }
      const jobId = "job-" + (jobs.size + 1);
      const job: DownloadJob = { jobId, state: "queued", total: body.externalIds.length, completed: 0, failed: 0,
        items: body.externalIds.map(externalId => ({ externalId, state: "queued" })) };
      jobs.set(jobId, job);
      return route.fulfill({ status: 202, json: job });
    }
    if (pathname.startsWith("/api/v1/online-download-jobs/")) {
      const id = pathname.split("/").at(-1)!;
      reads.push(id);
      if (searchParams.get("view") !== "summary") detailReads.push(id);
      const found = jobs.get(id);
      if (!found) return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
      json = searchParams.get("view") === "summary" ? {
        jobId: found.jobId, state: found.state, total: found.total, completed: found.completed, failed: found.failed,
      } : found;
    }
    if (req.method() !== "GET" && /playback|remote-playlists|plugin-settings|\/resolve/.test(pathname)) sideEffects.push(pathname);
    return route.fulfill({ json });
  });
  return { more, created, jobs, reads, detailReads, sideEffects, state, control };
}

test("batch downloads preserve cross-page selection, deduplicate tracks and restore their actual results", async ({ page }) => {
  const { more, created, jobs, reads, detailReads, sideEffects, state, control } = await fixture(page);
  const all = page.getByRole("checkbox", { name: "全选已加载的可下载曲目", exact: true });
  const dialog = page.getByRole("dialog", { name: "选择下载音质", exact: true });
  const history = page.getByRole("region", { name: "歌单下载任务", exact: true });
  try {
    await page.goto(locationOf("mix"));
    await expect(page.getByRole("row", { name: /内容已失效或不可用/ }).getByRole("checkbox")).toHaveCount(0);
    await all.check();
    await expect(page.getByRole("button", { name: "下载所选（1）", exact: true })).toBeEnabled();
    more.resolve();
    const second = page.getByRole("checkbox", { name: "选择 海潮", exact: true });
    await expect(second).not.toBeChecked();
    await expect(all).toHaveJSProperty("indeterminate", true);
    await expect(page.getByRole("checkbox", { name: "选择 山色", exact: true }).nth(1)).toBeChecked();
    await second.check();
    await expect(all).toBeChecked();
    await page.getByRole("button", { name: "下载所选（2）", exact: true }).click();
    await expect(dialog).toContainText("已选择 2 首曲目");
    await dialog.getByLabel("本次下载音质").selectOption({ label: "无损" });
    state.firstSubmitError = true;
    await dialog.getByRole("button", { name: "开始下载" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByRole("button", { name: "开始下载" }).click();
    await expect(history).toContainText("共 2 首，已下载 0 首，失败 0 首");
    expect(created).toHaveLength(2);
    expect(created[0].key).toBeTruthy();
    expect(created[1]).toEqual(created[0]);
    expect(created[0].csrf).toBe("test-csrf");
    expect(created[0].body).toEqual({ accountId: "listener-account", accountRevision: "revision-1", externalIds: ["1", "2"], quality: "lossless" });
    const job = jobs.get("job-1")!;
    await expect.poll(() => reads.length).toBeGreaterThan(0);
    const initialReads = reads.length;
    jobs.set(job.jobId, { ...job, state: "running", completed: 1, items: [
      { externalId: "1", state: "succeeded", version }, { externalId: "2", state: "running" },
    ] });
    control.event("downloads.progress", { jobs: [{ jobId: job.jobId, state: "running", total: 2, completed: 1, failed: 0 }], invalidated: [] });
    await expect(history).toContainText("共 2 首，已下载 1 首，失败 0 首");
    await page.clock.install();
    await page.clock.fastForward(4500);
    expect(reads).toHaveLength(initialReads);
    await page.goto(locationOf("other"));
    await expect(page.getByRole("heading", { name: "夜晚" })).toBeVisible();
    await expect(history).toHaveCount(0);
    await page.goto(locationOf("mix"));
    await expect(history).toContainText("正在下载");
    await page.reload();
    await expect(history).toContainText("所选音质 无损");
    jobs.set(job.jobId, { ...job, state: "partial", completed: 1, failed: 1, items: [
      { externalId: "1", state: "succeeded", version },
      { externalId: "2", state: "failed", error: { code: "AUDIO_CACHE_DISABLED", message: "Audio cache is disabled" } },
    ] });
    control.disconnect();
    await expect(history).toContainText("部分下载失败");
    expect(detailReads).toEqual([]);
    await history.getByRole("button", { name: "查看下载明细" }).click();
    await expect(history.getByRole("listitem").nth(0)).toContainText("山色 · 已完成 · 实际版本 标准 · MP3 · 128 kbps");
    await expect(history.getByRole("listitem").nth(1)).toContainText("请在插件设置中将音频缓存上限设为大于 0。");
    expect(detailReads).toEqual(["job-1"]);
    jobs.delete(job.jobId);
    const readCount = reads.length;
    await page.reload();
    await expect.poll(() => reads.length).toBeGreaterThan(readCount);
    await expect(history).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "下载 海潮" })).toBeVisible();
    expect(reads).toHaveLength(readCount + 1);
    expect(sideEffects).toEqual([]);
  } finally {
    more.resolve();
  }
});

test("a single-song download honors the source default and stays separate from playlist imports and playback", async ({ page }) => {
  const { more, created, jobs, state, sideEffects } = await fixture(page);
  more.resolve();
  state.qualities = [""];
  state.qualityError = true;
  await page.goto(locationOf("mix"));
  await page.getByRole("button", { name: "下载 海潮", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择下载音质" });
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "开始下载" })).toBeDisabled();
  state.qualityError = false;
  await dialog.getByRole("button", { name: "重试" }).click();
  await expect(dialog.getByLabel("本次下载音质")).toHaveValue("");
  await expect(dialog.getByRole("option", { name: "来源默认" })).toHaveCount(1);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(created).toEqual([]);
  await page.getByRole("button", { name: "下载 海潮", exact: true }).click();
  await page.evaluate(() => {
    // 局域网 HTTP 页面没有 randomUUID；首次取随机数失败时也应允许再次提交。
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
    const original = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: () => {
      Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: original });
      throw new Error("Random source unavailable");
    } });
  });
  await dialog.getByRole("button", { name: "开始下载" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(created).toEqual([]);
  await dialog.getByRole("button", { name: "开始下载" }).click();
  await expect.poll(() => jobs.size).toBe(1);
  expect(created[0].body.externalIds).toEqual(["2"]);
  expect(created[0].body.quality).toBe("");
  expect(created[0].key).toMatch(/^[a-f0-9]{32}$/);
  state.account = "another-account";
  const history = page.getByRole("region", { name: "歌单下载任务" });
  await page.reload();
  await expect(page.getByRole("button", { name: "下载 海潮", exact: true })).toBeVisible();
  await expect(history).toHaveCount(0);
  state.playable = false;
  await page.reload();
  await expect(page.getByRole("cell", { name: "海潮", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /已加载的可下载/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下载 海潮", exact: true })).toHaveCount(0);
  expect(sideEffects).toEqual([]);
});

test("download all includes unseen tracks and skips duplicate IDs and unavailable placeholders", async ({ page }) => {
  const { state, more, created } = await fixture(page);
  state.platform = "bilibili";
  state.externalIds = ["1", "missing", "unavailable:3:91", "1", "2"];
  state.complete = false;
  const all = page.getByRole("button", { name: "下载全部", exact: true });
  try {
    await page.goto(locationOf("mix"));
    await expect(all).toBeDisabled();
    await expect(page.getByText("歌单曲目未读取完整，请刷新歌单后再下载全部。")).toBeVisible();
    state.complete = true;
    await page.getByRole("button", { name: "刷新歌单" }).click();
    await expect(page.getByRole("row", { name: /内容已失效或不可用/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: "海潮", exact: true })).toHaveCount(0);
    await all.click();
    const dialog = page.getByRole("dialog", { name: "选择下载音质" });
    await expect(dialog).toContainText("已选择 2 首曲目");
    await dialog.getByRole("button", { name: "开始下载" }).click();
    await expect.poll(() => created.length).toBe(1);
    expect(created[0].body.externalIds).toEqual(["1", "2"]);
  } finally {
    more.resolve();
  }
});

test("download all posts the maximum playlist through HTTP while later track pages are pending", async ({ page }) => {
  const { state, jobs, more } = await fixture(page);
  const ids = Array.from({ length: 10_000 }, (_, index) => String(1_000_000_000_000_000_000n + BigInt(index)));
  state.externalIds = [...ids, "extra"];
  let method = "", path = "", size = 0, csrf = "", idempotency = "";
  const endpoint = createServer(async (req, response) => {
    method = req.method ?? "";
    path = req.url ?? "";
    csrf = String(req.headers["x-csrf-token"]);
    idempotency = String(req.headers["idempotency-key"]);
    const parts: Buffer[] = [];
    for await (const chunk of req) parts.push(Buffer.from(chunk));
    const bytes = Buffer.concat(parts);
    size = bytes.length;
    const received: DownloadRequest = JSON.parse(bytes.toString("utf8"));
    const job: DownloadJob = { jobId: "large", state: "queued", completed: 0, failed: 0,
      total: received.externalIds.length, items: received.externalIds.map(externalId => ({ externalId, state: "queued" })) };
    jobs.set(job.jobId, job);
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end(JSON.stringify(job));
  });
  await new Promise<void>(resolve => endpoint.listen(0, "127.0.0.1", resolve));
  try {
    const address = endpoint.address();
    if (!address || typeof address === "string") throw new Error("Missing HTTP address");
    await page.route("**/download-jobs", async route => {
      const upstream = await route.fetch({ url: `http://127.0.0.1:${address.port}${base}/download-jobs` });
      await route.fulfill({ response: upstream });
    });
    await page.goto(locationOf("mix"));
    const all = page.getByRole("button", { name: "下载全部", exact: true });
    await expect(all).toBeDisabled();
    await expect(page.getByText("每个下载任务最多选择 10000 首曲目。")).toBeVisible();
    state.externalIds = ids;
    await page.getByRole("button", { name: "刷新歌单" }).click();
    await all.click();
    const dialog = page.getByRole("dialog", { name: "选择下载音质", exact: true });
    await expect(dialog).toContainText("已选择 10000 首曲目");
    await dialog.getByRole("button", { name: "开始下载" }).click();
    await expect(page.getByRole("region", { name: "歌单下载任务" })).toContainText("共 10000 首");
    expect(method).toBe("POST");
    expect(path).toBe(base + "/download-jobs");
    expect(csrf).toBe("test-csrf");
    expect(idempotency).toMatch(/^[a-f0-9]{32}$/);
    expect(size).toBeGreaterThan(64 << 10);
    expect(size).toBeLessThan(2 << 20);
    expect(jobs.get("large")?.items.map(item => item.externalId)).toEqual(ids);
  } finally {
    more.resolve();
    await new Promise<void>((resolve, reject) => endpoint.close(error => error ? reject(error) : resolve()));
  }
});
