import type { Page } from "@playwright/test";
import type { WorkPackage } from "../../src/api/work-packages";
import { packageFixture, packagePNG, packageText, previewFixture } from "../fixtures/work-packages";

export async function mockPackages(page: Page) {
  const state = { packages: [] as WorkPackage[], previews: [] as Record<string, string>[], directories: [] as URL[],
    writes: [] as { body: unknown; key: string }[], replies: new Map<string, WorkPackage>(), attachments: [] as string[],
    failure: null as "network" | "gateway" | "invalid" | "conflict" | null, gate: null as Promise<void> | null,
    play: [] as Record<string, unknown>[], failPreview: false };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1", "");
    if (path === "/health/ready") return route.fulfill({ json: { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "package-test" } });
    if (path === "/auth/session") return route.fulfill({ json: { csrfToken: "csrf", user: { id: "listener", role: "user" } } });
    if (path === "/me/profile") return route.fulfill({ json: { user: { id: "listener", role: "user" }, nickname: "听众" } });
    if (path === "/content-types") return route.fulfill({ json: { items: [{ id: "asmr", pluginId: "example.asmr", pluginVersion: "1.0.0", name: "音声作品",
      description: "", creditRoles: [{ id: "circle", name: "社团" }], externalIdNamespaces: [], views: ["work-list", "work-detail"] }] } });
    if (path === "/works/one") return route.fulfill({ json: { workId: "one", contentType: "asmr", title: "雨夜音声", description: "多层目录与不同版本。",
      credits: [{ role: "circle", name: "雨夜社" }], externalIds: [], tags: [], revision: 1, createdAt: "2026-10-22", updatedAt: "2026-10-22" } });
    if (path.endsWith("/package-sources")) return route.fulfill({ json: { items: [{ providerInstanceId: "local", name: "本地作品", roots: [{ id: "root", name: "音声收藏" }] }] } });
    if (path.endsWith("/package-directories")) {
      state.directories.push(url); const selected = url.searchParams.get("path");
      return route.fulfill({ json: { path: selected, directories: selected === "." ? [{ name: "RJ123456 雨夜", path: "RJ123456 雨夜" }]
        : selected === "RJ123456 雨夜" ? [{ name: "WAV", path: "RJ123456 雨夜/WAV" }] : [] } });
    }
    if (path.endsWith("/package-previews")) {
      state.previews.push(request.postDataJSON());
      if (state.failPreview) { state.failPreview = false; return route.fulfill({ status: 500, json: { error: { code: "TEMPORARY_FAILURE" } } }); }
      return route.fulfill({ json: previewFixture(state.previews.length) });
    }
    if (path.endsWith("/packages") && request.method() === "GET") return route.fulfill({ json: { items: state.packages } });
    if (path.endsWith("/packages") && request.method() === "POST") {
      const key = request.headers()["idempotency-key"];
      state.writes.push({ body: request.postDataJSON(), key });
      if (state.gate) await state.gate;
      const cached = state.replies.get(key); if (cached) return route.fulfill({ json: cached });
      const failure = state.failure; state.failure = null;
      if (failure === "conflict") return route.fulfill({ status: 409, json: { error: { code: "CONFLICT" } } });
      const value = packageFixture((state.packages[0]?.revision ?? 0) + 1);
      state.packages = [value]; state.replies.set(key, value);
      if (failure === "network") return route.abort("failed");
      if (failure === "gateway") return route.fulfill({ status: 502, body: "Bad gateway" });
      if (failure === "invalid") return route.fulfill({ body: "invalid json" });
      return route.fulfill({ json: value });
    }
    if (path.includes("/attachments/")) {
      const name = decodeURIComponent(path.split("/attachments/")[1]); state.attachments.push(name);
      return route.fulfill({ contentType: name.endsWith(".png") ? "image/png" : "text/plain; charset=utf-8", body: name.endsWith(".png") ? packagePNG : packageText });
    }
    if (path === "/playback/sessions") {
      state.play.push(request.postDataJSON());
      return route.fulfill({ status: 400, json: { error: { code: "UNSUPPORTED" } } });
    }
    return route.fulfill({ json: { items: [], nextCursor: null, nextAfter: null, libraryRevision: "1" } });
  });
  return state;
}
