import { expect, type Page } from "@playwright/test";
import { routeApi } from "../fixtures/control-mock";
import { musicPage, musicTrack } from "../fixtures/music-catalog";
import { track } from "../fixtures/dto";
import type { SavedScrapedField, ScrapedItem } from "../../src/api/scrapers";

export const album = { albumId: "one", originalName: "原始夜间专辑", name: "夜间专辑", revision: 1, externalId: null,
  isExternal: false, coverPath: null, publisher: null as string | null, releaseDate: null as string | null,
  sourceUrl: null as string | null, sourcePluginId: null as string | null };
export const candidate = { id: "release-one", title: "夜间专辑发行版", sourceUrl: "https://example.org/release/one",
  artist: "河图", album: album.name, date: "2013-04-02T07:00:00Z", publisher: "星河唱片",
  genre: "Mandopop", description: "适合夜间聆听的作品。" };
export const completeCandidate = { ...candidate, tracks: [{ title: "第一曲", disc: 1, number: 1 },
  { title: "未收录曲目", disc: 1, number: 3 }] };
export const tracks = ["第一曲", "第二曲"].map((title, index) => ({ ...track, title, displayName: `${title}.flac`,
  sourceTrackId: `album-track-${index}`, artists: [candidate.artist], album: album.name, codec: "flac", container: "flac" }));
export const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#233c5d"/><stop offset="1" stop-color="#111f35"/></linearGradient></defs><rect width="160" height="160" fill="url(#bg)"/><circle cx="115" cy="42" r="21" fill="#e2c68b"/><path d="M0 105 Q45 70 85 108 T160 99 V160 H0Z" fill="#3c6982"/><path d="M0 130 Q50 100 92 133 T160 125 V160 H0Z" fill="#243e57"/></svg>`;

export async function mock(page: Page, { empty = false, coverPath = "/api/v1/media/album-artwork", brokenCover = false }:
  { empty?: boolean; coverPath?: string | null; brokenCover?: boolean } = {}) {
  const state = { album: { ...album, coverPath }, saved: [] as SavedScrapedField[], conflict: false,
    applied: false, trackSearchFailure: false, reads: [] as string[],
    online: { ...candidate } as ScrapedItem, platformTracks: completeCandidate.tracks,
    rotateTokens: false, tokenVersion: 0, mergeFailure: "none" as "none" | "before" | "after",
    receipts: new Map<string | undefined, number>(),
    searches: [] as Record<string, unknown>[], writes: [] as { path: string; body: Record<string, unknown>; key: string | undefined }[] };
  await routeApi(page, async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1", "");
    if (request.method() === "GET") state.reads.push(path);
    if (path === "/media/album-artwork") return brokenCover ? route.fulfill({ status: 404 })
      : route.fulfill({ contentType: "image/svg+xml", body: artwork });
    if (path === "/health/ready") return route.fulfill({ json: { product: "MusicFS", ready: true, apiVersion: "1", instanceId: "album-test" } });
    if (path === "/auth/session") return route.fulfill({ json: { csrfToken: "csrf", user: { id: "listener", role: "user" } } });
    if (path === "/me/profile") return route.fulfill({ json: { user: { id: "listener", role: "user" }, nickname: "听众" } });
    if (path === "/me/favorites") return route.fulfill({ json: { items: [], nextCursor: null, revision: "1" } });
    if (path === "/provider-instances") return route.fulfill({ json: { items: [{ id: track.providerInstanceId,
      name: "本地音乐", capabilities: [], availability: "available", roots: [] }] } });
    if (path === "/library/tracks") {
      const items = musicPage(empty ? [] : tracks).items;
      if (state.applied) items.push({ ...musicTrack(tracks[0]), trackId: "unavailable-online-track", title: "未收录曲目", selectedSource: null });
      return route.fulfill({ json: { ...musicPage([]), items } });
    }
    if (path === "/library/albums") return route.fulfill({ json: { items: [{ ...state.album,
      trackCount: (empty ? 0 : 2) + (state.applied ? 1 : 0) }], nextAfter: null } });
    if (path === "/library/albums/one") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        state.writes.push({ path, body, key: request.headers()["idempotency-key"] });
        expect(body.expectedRevision).toBe(state.album.revision);
        expect(body.originalName).toBeUndefined();
        state.album = { ...state.album, ...body, revision: state.album.revision + 1 };
      }
      return route.fulfill({ json: state.album });
    }
    if (path === "/library/albums/one/scraped-fields" && request.method() === "GET")
      return route.fulfill({ json: { items: state.saved } });
    if (path === "/library/albums/one/scraped-fields" && request.method() === "PUT") {
      const body = request.postDataJSON();
      state.writes.push({ path, body, key: request.headers()["idempotency-key"] });
      if (state.conflict) {
        state.conflict = false; state.album.revision++;
        return route.fulfill({ status: 409, json: { error: { code: "CONFLICT" } } });
      }
      expect(body.expectedRevision).toBe(state.album.revision);
      expect(body.candidates).toEqual({ albumDetails: "details-token", albumTracks: "tracks-token" });
      state.saved = [{ field: "albumDetails", pluginId: body.pluginId, item: candidate },
        { field: "albumTracks", pluginId: body.pluginId, item: completeCandidate }];
      state.applied = true;
      state.album.sourceUrl = candidate.sourceUrl;
      state.album.sourcePluginId = body.pluginId;
      state.album.revision++;
      return route.fulfill({ json: { revision: state.album.revision } });
    }
    if (path === "/library/albums/one/metadata-merge" && request.method() === "PUT") {
      const body = request.postDataJSON(), key = request.headers()["idempotency-key"];
      state.writes.push({ path, body, key });
      if (state.receipts.has(key)) return route.fulfill({ json: { revision: state.receipts.get(key) } });
      if (state.conflict) {
        state.conflict = false; state.album.revision++;
        return route.fulfill({ status: 409, json: { error: { code: "CONFLICT" } } });
      }
      if (state.mergeFailure === "before") {
        state.mergeFailure = "none";
        return route.fulfill({ status: 503, json: { error: { code: "TEMPORARY_FAILURE" } } });
      }
      expect(body.expectedRevision).toBe(state.album.revision);
      const fields = body.fields as string[];
      if (fields.includes("name")) state.album.name = state.online.album || state.online.title;
      if (fields.includes("releaseDate")) state.album.releaseDate = state.online.date?.slice(0, 10) ?? null;
      if (fields.includes("publisher")) state.album.publisher = state.online.publisher ?? null;
      if (fields.includes("cover")) state.album.coverPath = state.online.imageUrl ?? null;
      const current = state.saved.find((entry) => entry.field === "albumDetails");
      const item: ScrapedItem = current ? { ...current.item } : { id: state.online.id, title: state.album.name };
      for (const field of fields) {
        if (["artist", "genre", "description", "publisher"].includes(field))
          (item as unknown as Record<string, unknown>)[field] = (state.online as unknown as Record<string, unknown>)[field];
        if (field === "releaseDate") item.date = state.online.date;
      }
      if (fields.some((field) => !["name", "cover", "tracks"].includes(field))) {
        state.saved = state.saved.filter((entry) => entry.field !== "albumDetails");
        state.saved.unshift({ field: "albumDetails", pluginId: body.pluginId, item });
      }
      if (fields.includes("tracks")) {
        state.applied = true;
        state.saved = state.saved.filter((entry) => entry.field !== "albumTracks");
        state.saved.push({ field: "albumTracks", pluginId: body.pluginId,
          item: { ...state.online, tracks: state.platformTracks } });
      }
      state.album.revision++;
      state.receipts.set(key, state.album.revision);
      if (state.mergeFailure === "after") {
        state.mergeFailure = "none";
        return route.fulfill({ status: 503, json: { error: { code: "TEMPORARY_FAILURE" } } });
      }
      return route.fulfill({ json: { revision: state.album.revision } });
    }
    if (path === "/scrapers") return route.fulfill({ json: { items: [
      { pluginId: "album-source", name: "专辑资料源", type: "scraper", available: true, fields: ["albumDetails", "albumTracks", "artwork", "lyrics", "artistImage"] },
      { pluginId: "lyrics-source", name: "歌词资料源", type: "scraper", available: true, fields: ["lyrics"] },
      { pluginId: "details-source", name: "仅详情来源", type: "scraper", available: true, fields: ["albumDetails"] },
    ] } });
    if (path === "/scrapers/album-source/search") {
      const body = request.postDataJSON();
      state.searches.push(body);
      if (body.field === "albumDetails" && state.rotateTokens) state.tokenVersion++;
      if (body.field === "albumTracks" && state.trackSearchFailure)
        return route.fulfill({ status: 503, json: { error: { code: "SOURCE_UNAVAILABLE" } } });
      return route.fulfill({ json: { items: [{ ...state.online,
        ...(body.field === "albumTracks" ? { tracks: state.platformTracks } : {}),
        candidateToken: (body.field === "albumTracks" ? "tracks-token" : "details-token") +
          (state.rotateTokens ? `-${state.tokenVersion}` : "") }] } });
    }
    return route.fulfill({ json: { items: [], nextAfter: null, nextCursor: null, libraryRevision: "1" } });
  });
  return state;
}

export const dialog = (page: Page) => page.getByRole("dialog", { name: "搜索在线资料", exact: true });
export const details = (page: Page) => page.getByRole("region", { name: "专辑详情", exact: true });
export const detailsToggle = (page: Page) => page.getByRole("button", { name: "专辑详情", exact: true });
export const scraping = (page: Page) => page.getByRole("button", { name: "搜索在线资料", exact: true });
export async function openAlbum(page: Page, origin: string, search = true) {
  await page.goto(`${origin}/#/library?category=${encodeURIComponent("专辑")}`);
  await page.getByRole("button", { name: /^夜间专辑 \d+ 首$/ }).click();
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "false");
  if (search) await scraping(page).click();
}
