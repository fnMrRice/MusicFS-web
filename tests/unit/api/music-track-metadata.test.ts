import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/api/client";
import { MusicCatalogApi, type MusicTrack, type TrackMetadata } from "../../../src/api/music-catalog";

const metadata: TrackMetadata = { title: "Track", localizedTitles: [], artistNames: ["Artist"], genre: null,
  year: 2020, rating: null, coverPath: null };
const track: MusicTrack = { trackId: "track/1", title: "Track", revision: 3, artists: [{ artistId: "a", name: "Artist" }],
  albums: [{ albumId: "album", name: "Album" }], genre: null, year: 2020, rating: null, coverPath: null, selectedSource: null };
function setup(result: unknown) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(result)));
  const client = new ApiClient(fetch);
  client.csrfToken = "csrf";
  return { fetch, api: new MusicCatalogApi(client) };
}

describe("track metadata writes", () => {
  it("accepts an unchanged revision for an identical edit and leaves album membership to the server", async () => {
    const { api, fetch } = setup(track);
    await expect(api.updateTrackMetadata(track.trackId, 3, metadata, "edit")).resolves.toEqual(track);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("/api/v1/library/tracks/track%2F1");
    expect(JSON.parse(options.body)).toEqual({ expectedRevision: 3, ...metadata });
    expect(options.headers.get("Idempotency-Key")).toBe("edit");
  });

  it("sends final metadata and every selected revision together in a single album merge", async () => {
    const { api, fetch } = setup({ ...track, revision: 4 });
    const second = { ...track, trackId: "second", revision: 6 };
    await api.mergeAlbumTracks("album/1", 2, 7, track.trackId, [track, second], "merge", metadata);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("/api/v1/library/albums/album%2F1/merge-tracks");
    expect(options.headers.get("Idempotency-Key")).toBe("merge");
    expect(JSON.parse(options.body)).toEqual({ expectedAlbumRevision: 2, expectedMatchingRevision: 7,
      targetTrackId: track.trackId, tracks: [{ trackId: track.trackId, expectedRevision: 3 },
        { trackId: second.trackId, expectedRevision: 6 }], metadata });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
