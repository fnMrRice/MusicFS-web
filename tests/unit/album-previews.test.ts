import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/client";
import { ScrapersApi } from "../../src/api/scrapers";
import { AlbumPreviews } from "../../src/features/scrapers/album-previews";

afterEach(() => vi.useRealTimers());

it("refreshes expired selection tokens and separates releases by store and platform", async () => {
  vi.useFakeTimers();
  const started = Date.UTC(2026, 0, 1);
  vi.setSystemTime(started);
  const query = { externalId: "42", sourceUrl: "https://catalog.example/release/42", country: "JP" };
  const item = { id: "42", title: "Album", sourceUrl: query.sourceUrl, candidateToken: "initial" };
  let count = 0;
  const fetch = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
    const { field } = JSON.parse(String(init?.body));
    return Response.json({ items: [{ ...item, candidateToken: "token" + ++count,
      ...(field === "albumTracks" ? { tracks: [{ title: "First" }] } : {}) }] });
  });
  const previews = new AlbumPreviews(new ScrapersApi(new ApiClient(fetch)));
  const signal = new AbortController().signal;
  const options = { summary: { item, requestedAt: started } };
  const initial = await previews.read("first", query, signal, options);
  expect(initial.details.candidateToken).toBe("initial");
  expect(await previews.read("first", query, signal, options)).toBe(initial);
  expect(count).toBe(1);
  const us = await previews.read("first", { ...query, country: "US" }, signal);
  const second = await previews.read("second", query, signal);
  expect(us.details.candidateToken).toBe("token2");
  expect(second.details.candidateToken).toBe("token4");
  vi.setSystemTime(started + 30 * 60_000);
  const renewed = await previews.read("first", query, signal, options);
  expect(renewed.details.candidateToken).toBe("token6");
  expect(renewed.tracks.candidateToken).toBe("token7");
});
