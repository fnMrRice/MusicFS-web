import { expect, test, type Route } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { customProxy, mockProxyPlugins, openProxySettings, pluginEntry, proxyPlugins } from "../fixtures/plugin-proxy";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview server has no TCP address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

test("translated configuration buttons keep clear of plugin identity on a narrow screen", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("musicfs:language", "en"));
  await page.setViewportSize({ width: 390, height: 844 });
  await mockProxyPlugins(page);
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const entry = pluginEntry(page);
  const configure = page.getByRole("button", { name: "Configure Bangumi", exact: true });
  await expect(configure).toBeVisible();
  const configureBox = await configure.boundingBox();
  for (const text of ["Bangumi", "4 catalogs", "0.1.0"]) {
    const field = entry.locator(".plugin-entry-heading").getByText(text);
    await expect(field).toBeVisible();
    const box = await field.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(configureBox!.x);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("plugin-configuration-entries-mobile-en.png"), fullPage: true });
  await configure.click();
  const dialog = page.getByRole("dialog", { name: "Configure Bangumi", exact: true });
  await expect(dialog.getByRole("region", { name: "资料平台访问设置", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(entry.locator(".plugin-entry-toggle")).toHaveAttribute("aria-expanded", "false");
});

test("plugin-owned configuration opens from a collapsed row without expanding it", async ({ page }, info) => {
  await mockProxyPlugins(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const entry = pluginEntry(page);
  const toggle = entry.locator(".plugin-entry-toggle");
  const configure = entry.getByRole("button", { name: "配置 Bangumi", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(configure).toBeVisible();
  const heading = entry.locator(".plugin-entry-heading");
  const nameEnd = await heading.getByText("Bangumi", { exact: true }).evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().right;
  });
  const note = await heading.getByText("4 catalogs").boundingBox();
  const version = await heading.getByText("0.1.0").boundingBox();
  const button = await configure.boundingBox();
  expect(note!.x).toBeGreaterThanOrEqual(nameEnd);
  expect(note!.x - nameEnd).toBeLessThan(40);
  expect(note!.x + note!.width).toBeLessThanOrEqual(version!.x);
  expect(version!.x + version!.width).toBeLessThanOrEqual(button!.x);
  await toggle.focus();
  await page.keyboard.press("Tab");
  await expect(configure).toBeFocused();
  await page.screenshot({ path: info.outputPath("plugin-configuration-entries.png"), fullPage: true });
  const dialog = await openProxySettings(page);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toContainText("由资料平台提供的连接选项。");
  await expect(dialog.getByLabel("访问方式", { exact: true })).toHaveValue("environment");
  await expect(dialog.getByLabel("代理服务器", { exact: true })).toHaveValue("");
  await expect(dialog.getByRole("button", { name: /^(保存设置|正在保存…)$/ })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("plugin-proxy-desktop-dark.png"), fullPage: true });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(configure).toBeFocused();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(entry).toContainText("服务端内置");
  await expect(page.getByText(/内置能力已装配到服务端主进程/)).toHaveCount(0);
  const reopened = await openProxySettings(page);
  await reopened.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("save and cancel preserve independent values for any declared plugin", async ({ page }, info) => {
  const mock = await mockProxyPlugins(page);
  await page.goto(`${origin}/#/settings?tab=plugins`);
  let dialog = await openProxySettings(page);
  await customProxy(dialog);
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(dialog).toContainText("设置已保存。");
  expect(mock.submissions[0]).toMatchObject({ pluginId: proxyPlugins[0].pluginId, body: {
    expectedRevision: 3, schemaRevision: "scraper-proxy-v1", values: { proxyMode: "custom", proxyUrl: "http://127.0.0.1:7890" },
  } });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  dialog = await openProxySettings(page, 1);
  await expect(dialog.getByLabel("访问方式", { exact: true })).toHaveValue("environment");
  await customProxy(dialog, "socks5h://127.0.0.1:1080");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  dialog = await openProxySettings(page, 1);
  await expect(dialog.getByLabel("代理服务器", { exact: true })).toHaveValue("");
  await dialog.getByLabel("访问方式", { exact: true }).selectOption("direct");
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(dialog).toContainText("设置已保存。");
  expect(mock.settings.get(proxyPlugins[1].pluginId)?.values).toEqual({ proxyMode: "direct", proxyUrl: "" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("plugin-configuration-entries-mobile.png"), fullPage: true });
  dialog = await openProxySettings(page);
  await expect(dialog.getByLabel("访问方式", { exact: true })).toHaveValue("custom");
  await expect(dialog.getByLabel("代理服务器", { exact: true })).toHaveValue("http://127.0.0.1:7890");
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("plugin-proxy-mobile-light.png"), fullPage: true });
  expect(mock.submissions).toHaveLength(2);
});

test("a rejected proxy address can be corrected without retrying the rejected request", async ({ page }) => {
  const mock = await mockProxyPlugins(page);
  mock.intercept = async (route, submission) => {
    if (submission.body.values.proxyUrl !== "bad-address") return false;
    await route.fulfill({ status: 400, json: { error: { code: "INVALID_ARGUMENT", message: "Proxy URL is invalid" } } }); return true;
  };
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const dialog = await openProxySettings(page);
  await customProxy(dialog, "bad-address");
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "重试上次操作", exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("代理服务器", { exact: true })).toBeEnabled();
  await dialog.getByLabel("代理服务器", { exact: true }).fill("https://127.0.0.1:8443");
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(dialog).toContainText("设置已保存。");
  expect(mock.submissions).toHaveLength(2);
  expect(mock.submissions[1].key).not.toBe(mock.submissions[0].key);
  expect(mock.submissions[1].body.values.proxyUrl).toBe("https://127.0.0.1:8443");
});

test("a concurrent revision requires reloading the server values before saving", async ({ page }) => {
  const mock = await mockProxyPlugins(page);
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const dialog = await openProxySettings(page);
  const current = mock.settings.get(proxyPlugins[0].pluginId)!;
  mock.settings.set(current.pluginId, { ...current, revision: 4, values: { proxyMode: "direct", proxyUrl: "" } });
  await customProxy(dialog);
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("插件设置已发生变化");
  await expect(dialog.getByLabel("代理服务器", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "重新加载设置", exact: true }).click();
  await expect(dialog.getByLabel("访问方式", { exact: true })).toHaveValue("direct");
  await customProxy(dialog, "socks5://127.0.0.1:1080");
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(dialog).toContainText("设置已保存。");
  expect(mock.submissions[1].body.expectedRevision).toBe(4);
});

for (const committed of [false, true]) {
  test(`an uncertain save retries its original key and ${committed ? "reloads an already committed revision" : "saves unchanged data"}`, async ({ page }) => {
    const mock = await mockProxyPlugins(page);
    mock.intercept = async (route, submission) => {
      if (mock.submissions.length !== 1) return false;
      if (committed) {
        const current = mock.settings.get(submission.pluginId)!;
        mock.settings.set(current.pluginId, { ...current, revision: 4, values: submission.body.values });
      }
      if (committed) await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } });
      else await route.abort("failed");
      return true;
    };
    await page.goto(`${origin}/#/settings?tab=plugins`);
    const dialog = await openProxySettings(page);
    await customProxy(dialog);
    await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(dialog.getByLabel("代理服务器", { exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "重试上次操作", exact: true }).click();
    if (committed) {
      await expect(dialog.getByRole("alert")).toContainText("插件设置已发生变化");
      await dialog.getByRole("button", { name: "重新加载设置", exact: true }).click();
      await expect(dialog.getByLabel("代理服务器", { exact: true })).toHaveValue("http://127.0.0.1:7890");
      await expect(dialog.getByRole("button", { name: "保存设置", exact: true })).toBeDisabled();
    } else await expect(dialog).toContainText("设置已保存。");
    expect(mock.submissions).toHaveLength(2);
    expect(mock.submissions[0].key).toBeTruthy();
    expect(mock.submissions[1]).toEqual(mock.submissions[0]);
  });
}

test("saving keeps the dialog open through close, cancel, Escape and backdrop attempts", async ({ page }) => {
  const mock = await mockProxyPlugins(page);
  let pending: Route | null = null;
  mock.intercept = async route => { pending = route; return true; };
  await page.goto(`${origin}/#/settings?tab=plugins`);
  const dialog = await openProxySettings(page);
  await customProxy(dialog);
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => pending !== null).toBe(true);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: /^(保存设置|正在保存…)$/ })).toBeDisabled();
  expect(mock.submissions).toHaveLength(1);
  const current = mock.settings.get(proxyPlugins[0].pluginId)!;
  await (pending as unknown as Route).fulfill({ json: { ...current, revision: 4, values: mock.submissions[0].body.values } });
  await expect(dialog).toContainText("设置已保存。");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
