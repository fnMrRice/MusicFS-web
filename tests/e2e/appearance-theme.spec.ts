import { expect, test } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { routeApi } from "../fixtures/control-mock";
import { track } from "../fixtures/dto";
import { musicPage } from "../fixtures/music-catalog";

let server: PreviewServer;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
});
test.afterAll(async () => { await server?.close(); });

test("accent choices update playback, follow the selected appearance and survive reload", async ({ page }, info) => {
  await routeApi(page, route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/health/ready")) {
      return route.fulfill({ json: { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "appearance" } });
    }
    if (path.endsWith("/auth/session")) {
      return route.fulfill({ json: { csrfToken: "fixture", user: { id: "listener", role: "user" } } });
    }
    if (path.endsWith("/me/favorites")) {
      return route.fulfill({ json: { items: [], nextCursor: null, revision: "1" } });
    }
    if (path.endsWith("/library/tracks")) {
      const tracks = ["午后钢琴", "窗边的雨", "海边散步"].map((title, index) => ({
        ...track, title, sourceTrackId: String(index), artists: ["MusicFS"], album: "试听曲集",
      }));
      return route.fulfill({ json: musicPage(tracks) });
    }
    return route.fulfill({ json: { items: [], nextAfter: null, nextCursor: null, libraryRevision: "1" } });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(server.resolvedUrls!.local[0]);
  const root = page.locator("html");
  const playColor = () => page.locator(".play-main").evaluate(button => getComputedStyle(button).backgroundColor);
  const colorChoices = page.getByRole("group", { name: "主题色", exact: true });
  const modeChoices = page.getByRole("group", { name: "明暗模式", exact: true });
  await page.getByRole("button", { name: "换肤", exact: true }).click();
  await expect(colorChoices.getByRole("button", { name: "默认", exact: true })).toHaveAttribute("aria-pressed", "true");
  const defaultColor = await playColor();
  await colorChoices.getByRole("button", { name: "初音绿", exact: true }).click();
  await expect(root).toHaveAttribute("data-accent", "miku");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect.poll(playColor).not.toBe(defaultColor);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("miku-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).toHaveAttribute("data-accent", "miku");
  await modeChoices.getByRole("button", { name: "深夜 · 深色", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  const mikuColor = await playColor();
  await page.keyboard.press("Escape");

  await page.goto(new URL("#/settings?tab=appearance", page.url()).href);
  await expect(colorChoices.getByRole("button", { name: "初音绿", exact: true })).toHaveAttribute("aria-pressed", "true");
  await colorChoices.getByRole("button", { name: "天依蓝", exact: true }).click();
  await expect(root).toHaveAttribute("data-accent", "tianyi");
  await expect.poll(playColor).not.toBe(mikuColor);
  await page.reload();
  await expect(colorChoices.getByRole("button", { name: "天依蓝", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await modeChoices.getByRole("button", { name: "晨光 · 浅色", exact: true }).click();
  await page.goto(new URL("#/library", page.url()).href);
  await page.getByRole("button", { name: "换肤", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(colorChoices.getByRole("button", { name: "天依蓝", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("tianyi-light.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(colorChoices.getByRole("button", { name: "天依蓝", exact: true })).toBeInViewport();
  await modeChoices.getByRole("button", { name: "深夜 · 深色", exact: true }).click();
  await colorChoices.getByRole("button", { name: "默认", exact: true }).click();
  await expect(root).toHaveAttribute("data-accent", "default");
  await expect.poll(playColor).toBe(defaultColor);
});
