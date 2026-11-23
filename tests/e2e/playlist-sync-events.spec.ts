import { expect, test } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { routeApi } from "../fixtures/control-mock";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  origin = server.resolvedUrls!.local[0];
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

test("concurrent playlist syncs update independently on push and reconnect without resubmitting", async ({ page }) => {
  const jobs = new Map(["first", "second"].map(id => [id, { id, state: "queued", submissions: 0, reads: 0 }]));
  let lists = 0;
  const playlist = (id: string) => {
    const completed = jobs.get(id)!.state === "succeeded";
    return { playlistId: id, instanceId: "source", externalId: id, title: `Playlist ${id}`, bindingRevision: 5,
      revision: completed ? 1 : 0, stale: !completed, lastSuccessAt: null, error: null };
  };
  const control = await routeApi(page, route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = { items: [], nextCursor: null, nextAfter: null };
    if (path.endsWith("/health/ready")) json = { product: "MusicFS", apiVersion: "1", ready: true, instanceId: "fixture" };
    if (path.endsWith("/auth/session")) json = { csrfToken: "fixture", user: { id: "user", role: "user" } };
    if (path.endsWith("/tasks")) json = { items: [], nextCursor: null, activeCount: 0 };
    if (path.endsWith("/remote-playlists")) {
      ++lists;
      json = { items: Array.from(jobs.keys(), playlist), nextAfter: null };
    }
    for (const job of jobs.values()) {
      if (path.endsWith(`/remote-playlists/${job.id}`)) json = playlist(job.id);
      if (path.endsWith(`/remote-playlists/${job.id}/sync-jobs`)) {
        ++job.submissions;
        expect(route.request().method()).toBe("POST");
        expect(route.request().postDataJSON()).toEqual({ expectedBindingRevision: 5 });
        return route.fulfill({ status: 202, json: { jobId: job.id } });
      }
      if (path.endsWith(`/remote-playlist-sync-jobs/${job.id}`)) {
        ++job.reads;
        json = { jobId: job.id, state: job.state, resultRevision: job.state === "succeeded" ? 1 : null, error: null };
      }
    }
    return route.fulfill({ json });
  });

  await page.clock.install(); await page.goto(`${origin}#/playlists`);
  const row = (id: string) => page.locator(".remote-row").filter({ hasText: `Playlist ${id}` });
  const sync = (id: string) => row(id).getByRole("button", { name: "同步", exact: true });
  for (const job of jobs.values()) {
    await sync(job.id).click();
    await expect(row(job.id).getByRole("status")).toContainText("排队中");
  }
  const reads = () => Array.from(jobs.values(), job => job.reads);
  const initialReads = reads(), initialLists = lists;
  await page.clock.fastForward(6000);
  expect(reads()).toEqual(initialReads);

  jobs.get("first")!.state = "succeeded";
  jobs.get("second")!.state = "running";
  control.event("activity.changed", { resources: ["playlistSync"] });
  await expect(row("first")).toContainText("已有快照");
  await expect(sync("first")).toBeEnabled();
  await expect(row("second").getByRole("status")).toContainText("同步中");
  await expect(sync("second")).toBeDisabled();

  const sessionCheck = page.waitForRequest(request => request.url().endsWith("/auth/session"));
  control.disconnect(); await sessionCheck;
  jobs.get("second")!.state = "succeeded";
  await page.clock.runFor(1000);
  await expect(row("second")).toContainText("已有快照");
  await expect(sync("second")).toBeEnabled();
  expect(lists).toBe(initialLists);
  expect(Array.from(jobs.values(), job => job.submissions)).toEqual([1, 1]);
});
