import { expect, type Locator, type Page, type Route } from "@playwright/test";
import type { ManagedPlugin } from "../../src/api/directories";
import type { PluginSettings, SettingsRequest } from "../../src/api/plugin-settings";
import { routeApi } from "./control-mock";

export const proxyPlugins: ManagedPlugin[] = [
  ["musicfs.scraper.bangumi", "Bangumi", "scraper"],
  ["example.metadata.platform", "自定义资料平台", "metadata"],
].map(([id, name, feature]) => ({
  pluginId: id, plugin: { id, name, localizedNames: {}, features: ["metadata", feature] },
  version: "0.1.0", supportsMultipleInstances: false, instances: [], settingsAvailable: true,
  displayCount: feature === "scraper" ? { value: 4, unit: "catalogs", localizedUnits: {} } : undefined,
  execution: "builtin", builtin: { configured: false, capabilities: ["scraper.album"] },
}));

export function proxySettings(pluginId: string): PluginSettings {
  return { pluginId, revision: 3, values: { proxyMode: "environment", proxyUrl: "" }, schema: {
    revision: "scraper-proxy-v1", title: "资料平台访问设置", description: "由资料平台提供的连接选项。",
    fields: [
      { key: "proxyMode", type: "select", label: "访问方式", defaultValue: "environment", options: [
        { value: "environment", label: "跟随服务端环境" }, { value: "direct", label: "直连" }, { value: "custom", label: "自定义代理" },
      ] },
      { key: "proxyUrl", type: "text", label: "代理服务器", description: "支持 HTTP、HTTPS 和 SOCKS5 代理地址。", defaultValue: "", maxLength: 2048 },
    ], actions: [],
  } };
}

export interface ProxySubmission { pluginId: string; body: SettingsRequest; key?: string }
export interface ProxyMock {
  settings: Map<string, PluginSettings>;
  submissions: ProxySubmission[];
  intercept?: (route: Route, submission: ProxySubmission) => Promise<boolean>;
}

export async function mockProxyPlugins(page: Page): Promise<ProxyMock> {
  const mock: ProxyMock = { settings: new Map(proxyPlugins.map(p => [p.pluginId, proxySettings(p.pluginId)])), submissions: [] };
  await routeApi(page, async route => {
    const path = new URL(route.request().url()).pathname;
    const id = path.startsWith("/api/v1/plugin-settings/") ? decodeURIComponent(path.slice("/api/v1/plugin-settings/".length)) : null;
    if (id && mock.settings.has(id)) {
      if (route.request().method() === "PUT") {
        const submission = { pluginId: id, body: route.request().postDataJSON() as SettingsRequest, key: route.request().headers()["idempotency-key"] };
        mock.submissions.push(submission);
        if (await mock.intercept?.(route, submission)) return;
        const current = mock.settings.get(id)!;
        expect(submission.body.schemaRevision).toBe(current.schema.revision);
        if (submission.body.expectedRevision !== current.revision) {
          await route.fulfill({ status: 409, json: { error: { code: "REVISION_CONFLICT" } } }); return;
        }
        mock.settings.set(id, { ...current, revision: current.revision + 1, values: submission.body.values });
      }
      await route.fulfill({ json: mock.settings.get(id) }); return;
    }
    let json: unknown = { items: [], nextCursor: null, nextAfter: null, libraryRevision: "1" };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "proxy-fixture" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "admin", role: "admin" } };
    if (path.endsWith("/admin/plugins")) json = { items: proxyPlugins };
    if (path.endsWith("/scan-status")) json = { job: null };
    if (path.endsWith("/root-statistics")) json = { roots: [] };
    await route.fulfill({ json });
  });
  return mock;
}

export function pluginEntry(page: Page, index = 0) {
  return page.getByRole("listitem").filter({ has: page.getByText(proxyPlugins[index].pluginId, { exact: true }) });
}

export async function openProxySettings(page: Page, index = 0): Promise<Locator> {
  const name = `配置 ${proxyPlugins[index].plugin.name}`;
  await page.getByRole("button", { name, exact: true }).click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(dialog.getByRole("region", { name: "资料平台访问设置", exact: true })).toBeVisible();
  return dialog;
}

export async function customProxy(dialog: Locator, address = "http://127.0.0.1:7890") {
  await dialog.getByLabel("访问方式", { exact: true }).selectOption("custom");
  await dialog.getByLabel("代理服务器", { exact: true }).fill(address);
}
