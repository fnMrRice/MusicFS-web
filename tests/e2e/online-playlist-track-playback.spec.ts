import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { audioFixture } from "../fixtures/audio";
import { routeApi } from "../fixtures/control-mock";
import { deferred, playback, track as sourceTrack } from "../fixtures/dto";
import { instanceIds, neteasePlugin } from "../fixtures/plugins";
import { seekTo, waitPlaying } from "./helpers";

let server: PreviewServer;
let origin: string;
test.beforeAll(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

async function openPlaylist(page: Page) {
  const source = instanceIds.netease;
  const base = `/api/v1/online-instances/${source}`;
  const path = base + "/playlists/mix";
  const artwork = "https://p1.music.126.net/";
  const playlist = { externalId: "mix", title: "午后歌单", sourceUrl: "", trackCount: 4, coverUrl: artwork + "mix.svg" };
  const songs = [
    { externalId: "101", title: "山色", coverUrl: artwork + "mountain.svg" },
    { externalId: "102", title: "海潮", coverUrl: artwork + "ocean.svg" },
    { externalId: "103", title: "留白", coverUrl: null },
    { externalId: "104", title: "远行", coverUrl: artwork + "missing.svg" },
  ].map(song => ({ ...song, artists: ["试音乐队"], album: "", sourceUrl: "", durationMs: 30_000 }));
  const entries = songs.map((song, position) => ({ position, externalTrackId: song.externalId }));
  const palette = new Map([["mix.svg", "#a46b44"], ["mountain.svg", "#3f7454"], ["ocean.svg", "#4779a3"]]);
  const coverRequests: string[] = [];
  await page.route(artwork + "**", route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    coverRequests.push(name);
    const color = palette.get(name);
    if (!color) return route.fulfill({ status: 404 });
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/><circle cx="45" cy="19" r="9" fill="#eedcae"/><path d="M0 59L24 23L46 52L54 41L64 54V64H0Z" fill="#233c47"/></svg>`;
    return route.fulfill({ contentType: "image/svg+xml", body });
  });
  const resolutions: string[] = [], starts: string[] = [], playlistWrites: string[] = [];
  const sound = audioFixture();
  await routeApi(page, route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    let json: unknown = { items: [], nextAfter: null };
    if (pathname.endsWith("/health/ready")) json = { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "fixture" };
    if (pathname.endsWith("/auth/session")) json = { csrfToken: "test", user: { id: "listener", role: "user" } };
    if (pathname.endsWith("/online-instances")) json = { items: [{
      instanceId: source, name: "Listener", accountId: "account", accountRevision: "1", platform: "netease",
      plugin: neteasePlugin, availability: "available", capabilities: [{ name: "stream.resolve", supported: true, reason: "" }],
    }] };
    if (pathname.endsWith("/account")) json = { state: "signedIn", accountId: "account" };
    if (pathname === path) json = { playlist, entries, complete: true, observedAt: "2026-11-23T00:00:00Z" };
    if (pathname === path + "/tracks") json = { playlist, complete: true, nextCursor: null,
      items: songs.map((track, position) => ({ track, position, externalId: track.externalId, errorCode: null })) };
    if (request.method() !== "GET" && pathname.includes("playlist")) playlistWrites.push(pathname);
    if (pathname.startsWith(base + "/tracks/") && pathname.endsWith("/resolve")) {
      const id = pathname.split("/").at(-2);
      const song = songs.find(song => song.externalId === id)!;
      resolutions.push(song.externalId);
      json = { ...sourceTrack, sourceTrackId: "source-" + id, providerInstanceId: source, assetId: "asset-" + id,
        displayName: song.title, title: song.title, artists: song.artists, container: null, codec: null,
        onlineCoverPath: song.coverUrl ? `/api/v1/source-tracks/source-${id}/online-artwork` : null };
    }
    if (pathname.endsWith("/online-artwork")) return route.fulfill({ contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="#4779a3"/></svg>' });
    if (pathname.endsWith("/playback/sessions") && request.method() === "POST") {
      const { sourceTrackId } = request.postDataJSON();
      starts.push(sourceTrackId);
      const sessionId = "session-" + starts.length, attemptId = "attempt-" + starts.length;
      json = { ...playback(attemptId), outputProfilePending: true, deliveryMode: "proxy", sessionId, sourceTrackId, assetId: sourceTrackId.replace("source-", "asset-"),
        streamUrl: `/api/v1/playback/sessions/${sessionId}/attempts/${attemptId}/stream` };
    }
    if (pathname.endsWith("/output-profile")) json = { ...playback().outputProfile, sampleRate: 16000, bitrateBps: 256000, channels: 1 };
    if (pathname.endsWith("/stream")) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range ?? "");
      const headers = { "Accept-Ranges": "bytes" };
      if (!range) return route.fulfill({ contentType: "audio/wav", headers, body: sound });
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : sound.length - 1;
      return route.fulfill({ status: 206, contentType: "audio/wav",
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${sound.length}` }, body: sound.subarray(start, end + 1) });
    }
    if (request.method() === "DELETE") return route.fulfill({ status: 204 });
    return route.fulfill({ json });
  });

  await page.goto(`${origin}/#/discover/${source}/mix`);
  const row = (title: string) => page.getByRole("row").filter({ has: page.getByRole("button", { name: "播放 " + title, exact: true }) });
  await expect(page.getByRole("heading", { name: playlist.title })).toBeVisible();
  return { row, songs, coverRequests, starts, resolutions, playlistWrites };
}

async function holdNextResolve(page: Page, externalId: string) {
  const received = deferred<void>(), resume = deferred<void>(), released = deferred<void>();
  await page.route(`**/tracks/${externalId}/resolve`, async route => {
    received.resolve();
    await resume.promise;
    try { await route.fallback(); } finally { released.resolve(); }
  }, { times: 1 });
  return { received: received.promise, release: () => resume.resolve(), released: released.promise };
}

test("online playlist rows show their own artwork and play the chosen track without importing", async ({ page }, testInfo) => {
  const { row, songs, coverRequests, starts, resolutions, playlistWrites } = await openPlaylist(page);
  for (const song of songs.slice(0, 2)) {
    const image = row(song.title).locator(".cover img");
    await expect(image).toHaveAttribute("src", song.coverUrl!);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
  }
  for (const song of songs.slice(2)) {
    await expect(row(song.title).locator(".cover svg")).toBeVisible();
    await expect(row(song.title).locator(".cover img")).toHaveCount(0);
  }
  expect(coverRequests).toContain("missing.svg");
  const screenshot = testInfo.outputPath("playlist-detail.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("online-playlist-detail", { path: screenshot, contentType: "image/png" });

  await row("留白").getByRole("button", { name: "加入队列", exact: true }).click();
  const queueToggle = page.getByRole("button", { name: "播放队列", exact: true });
  const queue = page.getByRole("dialog", { name: "播放队列", exact: true });
  const queued = queue.getByRole("listitem").getByRole("button");
  await queueToggle.click();
  await expect(queued).toHaveText(["留白"]);
  expect(starts).toEqual([]);
  await queueToggle.click();
  await row("海潮").getByRole("button", { name: "播放 海潮", exact: true }).click();
  await waitPlaying(page);
  expect(resolutions).toEqual(["103", "102"]);
  expect(starts).toEqual(["source-102"]);
  const proxyCover = "/api/v1/source-tracks/source-102/online-artwork";
  await expect(page.locator(".now-playing .cover img")).toHaveAttribute("src", proxyCover);
  await expect(page.locator(".player-status")).toHaveText("WAV → PCM · 16 kHz · 256 kbps · 1 声道");
  await seekTo(page, 15);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(15);
  await queueToggle.click();
  await expect(queued).toHaveText(["留白", "海潮"]);
  await expect(queue.getByRole("button", { name: "海潮", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(queue.getByRole("button", { name: "海潮", exact: true }).locator("img")).toHaveAttribute("src", proxyCover);
  await queueToggle.click();

  await page.getByRole("button", { name: "播放全部", exact: true }).click();
  await expect.poll(() => starts).toEqual(["source-102", "source-101"]);
  await waitPlaying(page);
  await queueToggle.click();
  await expect(queued).toHaveText(songs.map(song => song.title));
  await expect(queued.first()).toHaveAttribute("aria-current", "true");
  expect(playlistWrites).toEqual([]);
});

test("a visible online source cover retries once after temporary pressure and keeps a placeholder on permanent failure", async ({ page }) => {
  const { row } = await openPlaylist(page);
  const attempts: Record<string, number> = {};
  await page.route("**/source-tracks/*/online-artwork", route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    attempts[id] = (attempts[id] || 0) + 1;
    if (id === "source-101") return route.fulfill({ status: 404 });
    if (attempts[id] === 1) return route.fulfill({ status: 429 });
    return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=", "base64") });
  });
  await page.clock.install();
  const cover = page.locator(".now-playing .cover");
  for (const [id, name] of [["source-102", "海潮"], ["source-101", "山色"]]) {
    await row(name).getByRole("button", { name: "播放 " + name, exact: true }).click();
    await expect.poll(() => attempts[id]).toBe(1);
    await expect(cover.locator("svg")).toBeVisible();
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await page.clock.fastForward(16_000);
    await expect.poll(() => attempts[id]).toBe(2);
    if (id === "source-102") await expect(cover.locator("img")).toBeVisible();
    else await expect(cover.locator("svg")).toBeVisible();
    await page.clock.fastForward(20_000);
    expect(attempts[id]).toBe(2);
  }
});

test("play all supersedes a pending row even when the row resolves after playback starts", async ({ page }) => {
  const { starts, songs } = await openPlaylist(page);
  const stale = await holdNextResolve(page, "102");
  const second = page.getByRole("button", { name: "播放 海潮", exact: true });
  try {
    await second.click();
    await stale.received;
    await page.getByRole("button", { name: "播放全部", exact: true }).click();
    await waitPlaying(page);
    expect(starts).toEqual(["source-101"]);
    stale.release();
    await stale.released;
    await expect(second).toBeEnabled();
    await page.getByRole("button", { name: "播放队列", exact: true }).click();
    const queue = page.getByRole("dialog", { name: "播放队列", exact: true });
    await expect(queue.getByRole("listitem").getByRole("button")).toHaveText(songs.map(song => song.title));
    await expect(queue.getByRole("button", { name: "山色", exact: true })).toHaveAttribute("aria-current", "true");
    expect(starts).toEqual(["source-101"]);
  } finally {
    stale.release();
  }
});

test("a row supersedes a pending playlist before either track resolves", async ({ page }) => {
  const { starts } = await openPlaylist(page);
  const first = await holdNextResolve(page, "101");
  const second = await holdNextResolve(page, "102");
  const playAll = page.getByRole("button", { name: "播放全部", exact: true });
  try {
    await playAll.click();
    await first.received;
    await page.getByRole("button", { name: "播放 海潮", exact: true }).click();
    await second.received;
    first.release();
    await first.released;
    await expect(playAll).toBeEnabled();
    expect(starts).toEqual([]);
    second.release();
    await waitPlaying(page);
    await page.getByRole("button", { name: "播放队列", exact: true }).click();
    const queue = page.getByRole("dialog", { name: "播放队列", exact: true });
    await expect(queue.getByRole("listitem").getByRole("button")).toHaveText(["海潮"]);
    await expect(queue.getByRole("button", { name: "海潮", exact: true })).toHaveAttribute("aria-current", "true");
    expect(starts).toEqual(["source-102"]);
  } finally {
    first.release();
    second.release();
  }
});
