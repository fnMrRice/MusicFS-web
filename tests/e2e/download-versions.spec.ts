import { expect, test } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import type { DownloadVersion, SourceTrack } from "../../src/api/types";
import { musicPage } from "../fixtures/music-catalog";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

function version(versionId: string, quality: string, codec: string, bitrateBps: number): DownloadVersion {
  return { versionId, quality, codec, bitrateBps, container: codec, mime: `audio/${codec}`,
    sizeBytes: 2097152, downloadedAt: "2026-11-20T12:00:00Z" };
}

function source(sourceTrackId: string, providerInstanceId: string, title: string, downloadVersions: DownloadVersion[]): SourceTrack {
  return { sourceTrackId, providerInstanceId, title, displayName: title, artists: [], durationMs: 60000,
    container: null, codec: null, bitrateBps: null, availability: "available", assetId: sourceTrackId,
    downloaded: downloadVersions.length > 0, downloadVersions };
}

test("saved qualities and version deletion follow the server for standalone and grouped sources", async ({ page }) => {
  const local = source("local", "folder", "组合曲目", []);
  const bili = source("bili", "bilibili", "视频音轨", [version("v-aac", "", "aac", 160000)]);
  const solo = source("solo", "netease", "独立曲目", [version("copy-001", "lossless", "flac", 980000),
    version("copy-002", "lossless", "flac", 980000), version("v-high", "exhigh", "mp3", 320000)]);
  let deletes = 0, reads = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let json: unknown = { items: [], nextCursor: null, nextAfter: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "download-test" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "csrf", user: { id: "user", role: "user" } };
    if (path.endsWith("/library/tracks")) json = musicPage([solo, { ...local, versions: [local, bili] }]);
    if (path.includes("/downloads/")) {
      expect(request.method()).toBe("DELETE");
      expect(request.headers()["x-csrf-token"]).toBe("csrf");
      expect(request.postData()).toBeNull();
      deletes++;
      if (path.endsWith("/source-tracks/solo/downloads/copy-001")) {
        if (deletes === 1) return route.fulfill({ status: 503, json: { error: { code: "SOURCE_UNAVAILABLE" } } });
        await pending;
        solo.downloadVersions = [...solo.downloadVersions!.filter(v => v.versionId !== "copy-001"),
          version("new", "hires", "flac", 3400000)];
      } else {
        expect(path).toBe("/api/v1/source-tracks/bili/downloads/v-aac");
        bili.downloaded = false;
        bili.downloadVersions = [];
      }
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/source-tracks/solo") || path.endsWith("/source-tracks/bili")) {
      if (++reads === 1) return route.fulfill({ status: 503, json: { error: { code: "SOURCE_UNAVAILABLE" } } });
      json = path.endsWith("/solo") ? solo : bili;
    }
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/#/library`);
  const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: "播放 独立曲目", exact: true }) });
  await expect(row.locator(".source-downloads")).toHaveCount(0);
  await row.getByRole("button", { name: "展开 独立曲目 的来源版本" }).click();
  const soloVersion = page.locator(".track-version").filter({ has: page.getByRole("button", { name: "播放来源版本 独立曲目" }) });
  const details = soloVersion.locator(".source-downloads");
  await expect(details.locator("summary")).toHaveText("已下载 · 3 个版本 · 无损 / 极高");
  await details.locator("summary").click();
  const target = details.getByRole("button", { name: /删除下载版本 .*#copy-001/ });
  const dialog = page.getByRole("dialog", { name: "删除下载版本" });
  const submit = dialog.getByRole("button", { name: "删除", exact: true });
  await target.click();
  await expect(dialog).toContainText("独立曲目");
  await expect(dialog).toContainText("#copy-001");
  await dialog.getByRole("button", { name: "取消" }).click();
  expect(deletes).toBe(0);
  await target.click();
  await submit.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await submit.click();
  await expect(submit).toBeDisabled();
  expect(deletes).toBe(2);
  release();
  await soloVersion.getByRole("button", { name: "重试" }).click();
  await expect(details.locator("summary")).toHaveText("已下载 · 3 个版本 · 无损 / 极高 / 高解析度无损");
  await details.locator("summary").click();
  await expect(details.locator("li")).toHaveCount(3);
  await expect(details.getByText(/高解析度无损 · FLAC/)).toBeVisible();
  expect(reads).toBe(2);
  await page.getByRole("button", { name: "展开 组合曲目 的来源版本" }).click();
  const nested = page.locator(".track-version").filter({ hasText: "视频音轨" });
  await expect(nested.locator("summary")).toHaveText("已下载 · 1 个版本 · AAC · 160 kbps");
  await nested.locator("summary").click();
  await nested.getByRole("button", { name: "删除下载版本 AAC · 160 kbps" }).click();
  await expect(dialog).toContainText("视频音轨");
  await submit.click();
  await expect(nested.locator(".source-downloads")).toHaveCount(0);
  await expect(nested.getByRole("button", { name: "播放来源版本 视频音轨" })).toBeVisible();
  await expect(details.locator("li")).toHaveCount(3);
  expect([deletes, reads]).toEqual([3, 3]);
});
