import { expect, type Page } from "@playwright/test";
import type { RefreshTask } from "../../src/api/tasks";
import { instanceIds, localPlugin } from "./plugins";
import { routeApi } from "./control-mock";
import { refreshTask } from "./tasks";

export const taskRoots = [{ id: "music", name: "Music", pathConfigured: true }, { id: "other", name: "Other", pathConfigured: true },
  { id: "third", name: "Third", pathConfigured: true }];
const options = { recursive: true, maxDepth: 0, importLyrics: false, importArtwork: false, excludePatterns: [], skipHidden: true, respectNoMedia: true };
export async function taskQueueMock(page: Page) {
  const state = { tasks: [] as RefreshTask[], posts: [] as { roots: string[]; key: string }[], scopes: [] as string[],
    cancellations: [] as { id: string; scope: string }[], admin: true, uncertain: "", configWrites: 0, unavailable: false,
    activeCount: null as number | null, listError: false };
  const keys = new Map<string, string>();
  const control = await routeApi(page, async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    if (path.endsWith("/scan-jobs") && method === "POST") {
      const body = route.request().postDataJSON(), key = route.request().headers()["idempotency-key"];
      expect(body.mode).toBe("full"); expect(body.schemaRevision).toBe("local-import-v5");
      expect(body.options).toEqual({ refreshMetadata: true }); expect(body.rootIds).toHaveLength(1);
      expect(key).toBeTruthy(); state.posts.push({ roots: body.rootIds, key });
      const existing = keys.get(key) ?? state.tasks.find(task => task.rootIds[0] === body.rootIds[0] && ["queued", "running", "cancelling"].includes(task.status))?.id;
      if (existing) return route.fulfill({ status: 202, json: { jobId: existing, merged: true } });
      const id = `task-${state.tasks.length + 1}`, root = taskRoots.find(item => item.id === body.rootIds[0])!;
      keys.set(key, id);
      state.tasks.unshift(refreshTask({ id, providerInstanceId: instanceIds.local, rootIds: [root.id], roots: [{ id: root.id, name: root.name }] }));
      if (state.uncertain === root.id) { state.uncertain = ""; return route.abort("failed"); }
      return route.fulfill({ status: 202, json: { jobId: id, merged: false } });
    }
    if (path === "/api/v1/tasks") {
      const scope = url.searchParams.get("scope")!; state.scopes.push(scope);
      if (state.listError) return route.fulfill({ status: 503, json: { error: { code: "SOURCE_UNAVAILABLE", message: "Task queue unavailable" } } });
      if (!state.admin && scope === "all") return route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "Forbidden" } } });
      const items = state.tasks.filter(task => scope === "all" || task.ownerId === "user");
      return route.fulfill({ json: { items, nextCursor: null,
        activeCount: state.activeCount ?? items.filter(task => ["queued", "running", "cancelling"].includes(task.status)).length } });
    }
    if (path.startsWith("/api/v1/tasks/")) {
      const id = path.split("/")[4], task = state.tasks.find(item => item.id === id), scope = url.searchParams.get("scope")!;
      if (!task || scope === "mine" && task.ownerId !== "user") return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Task not found" } } });
      if (path.endsWith("/cancel")) {
        state.cancellations.push({ id, scope }); expect(route.request().postDataJSON()).toEqual({});
        Object.assign(task, { status: "cancelled", phase: "finished", cancelRequested: true, cancellable: false,
          error: { code: "CANCELED", message: "Task cancelled" } });
      }
      return route.fulfill({ json: task });
    }
    let json: unknown = { items: [], nextCursor: null };
    if (path.endsWith("/scan-status")) json = { job: null };
    if (path.endsWith("/root-statistics")) json = { roots: [] };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "fixture" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "user", role: state.admin ? "admin" : "user" } };
    if (path.endsWith("/provider-instances")) json = { items: [{ id: instanceIds.local, name: "本地音乐", plugin: localPlugin,
      availability: state.unavailable ? "offline" : "available", capabilities: ["library.scan"], scanState: "idle", roots: taskRoots,
      configuration: { schemaRevision: "local-import-v5", importDefaults: options } }] };
    if (path.endsWith("/admin/plugins")) json = { items: [{ pluginId: localPlugin.id, plugin: localPlugin, version: "0.3.0",
      supportsMultipleInstances: false, instances: [{ instanceId: instanceIds.local, name: "本地音乐", runtimeState: state.unavailable ? "disabled" : "ready" }] }] };
    if (path.endsWith("/configuration")) {
      if (method !== "GET") ++state.configWrites;
      json = { revision: "fixture-revision", roots: taskRoots, rootImportDefaultsSupported: true,
        importOptions: { schemaRevision: "local-import-v5", importDefaults: options } };
    }
    await route.fulfill({ json });
  });
  return Object.assign(state, { control });
}
