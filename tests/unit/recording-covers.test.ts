import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordingCovers, trackCover } from "../../src/app/recording-covers";
import { Services } from "../../src/app/services";
import { track } from "../fixtures/dto";
import { displaySource, playlistTrack } from "../../src/api/music-catalog";
import { musicTrack } from "../fixtures/music-catalog";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Recording artwork metadata", () => {
  it("uses the verified proxy for the group, a forced local source, and previously queued entries", () => {
    const covers = new RecordingCovers();
    const path = "/api/v1/source-tracks/online/online-artwork";
    const group = musicTrack({ ...track, recordingId: "recording", onlineCoverPath: path, versions: [track] });
    const queued = displaySource(playlistTrack(group, track.sourceTrackId))!;
    expect(trackCover(queued, covers.value)).toBe(path);
    const manual = displaySource({ ...group, coverPath: "/api/v1/media/manual" })!;
    expect(trackCover(manual, covers.value)).toBe("/api/v1/media/manual");
    covers.reconcile([manual], [queued]);
    expect(trackCover(queued, covers.value)).toBe("/api/v1/media/manual");
    covers.reconcile([group.selectedSource!], [queued]);
    expect(trackCover(queued, covers.value)).toBe(path);
    expect(trackCover({ ...track, coverObjectId: "recording-art", onlineCoverPath: path }, covers.value)).toBe("/api/v1/media/recording-art");
    for (const unsafe of ["//host/art", "https://host/art", "/api/v1/auth/session", "/api/v1/source-tracks/../online-artwork"]) {
      expect(trackCover({ ...track, onlineCoverPath: unsafe }, covers.value)).toBeUndefined();
    }
  });
  it("uses server-confirmed artwork without mutating source candidates and keeps explicit empty selection", () => {
    const covers = new RecordingCovers();
    const source = { ...track, recordingId: "recording", coverObjectId: "small" };
    const group = { ...source, coverObjectId: "large", versions: [source] };
    expect(trackCover(group, covers.value)).toBe("/api/v1/media/large");
    covers.update("recording", "selected", [group]);
    expect(trackCover(group, covers.value)).toBe("/api/v1/media/selected");
    expect(group.versions[0].coverObjectId).toBe("small");
    expect(trackCover({ ...group, coverObjectId: "newer" }, covers.value)).toBe("/api/v1/media/newer");
    covers.update("recording", null, [group]);
    expect(trackCover(group, covers.value)).toBeNull();
    covers.clear();
    expect(trackCover(group, covers.value)).toBe("/api/v1/media/large");
  });

  it("reconciles old queue objects after automatic selection changes or a source leaves the recording", () => {
    const covers = new RecordingCovers();
    const source = { ...track, recordingId: "recording", coverObjectId: "small" };
    covers.update("recording", "large", [source]);
    covers.reconcile([{ ...source, coverObjectId: "larger" }], [source]);
    expect(trackCover(source, covers.value)).toBe("/api/v1/media/larger");
    covers.reconcile([{ ...source, recordingId: null, coverObjectId: "small" }], [source]);
    expect(trackCover(source, covers.value)).toBe("/api/v1/media/small");
    covers.update("recording", "other-member", [source]);
    expect(trackCover(source, covers.value)).toBe("/api/v1/media/small");
    covers.reconcile([{ ...source, recordingId: null, coverObjectId: null }], [source]);
    expect(trackCover(source, covers.value)).toBeNull();
  });

  it("recognizes a queued source candidate without recording metadata and later uses its group's new artwork", () => {
    const covers = new RecordingCovers();
    const source = { ...track, coverObjectId: "small" };
    covers.update("recording", "selected", [source], [source.sourceTrackId]);
    expect(trackCover(source, covers.value)).toBe("/api/v1/media/selected");
    covers.reconcile([{ ...source, sourceTrackId: "representative", recordingId: "recording", coverObjectId: "larger", versions: [source] }], [source]);
    expect(trackCover(source, covers.value)).toBe("/api/v1/media/larger");
    expect(source.coverObjectId).toBe("small");
  });

  it("refreshes the library and queued display metadata without changing playback or queue state, then clears on logout", () => {
    vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => "probably" }) });
    const services = new Services({} as HTMLElement);
    const source = { ...track, recordingId: "recording", coverObjectId: "old" };
    services.enqueue([source]);
    services.player.state.track = source;
    services.player.state.positionMs = 23000;
    const queue = services.queue.value;
    const player = services.player.state;
    const refresh = vi.spyOn(services.library("all"), "refresh").mockResolvedValue(undefined);
    const select = vi.spyOn(services.player, "select");
    services.recordingCoverChanged("recording", "chosen");
    expect(refresh).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    expect(services.queue.value).toBe(queue);
    expect(services.player.state).toBe(player);
    expect(services.player.state.positionMs).toBe(23000);
    expect(trackCover(services.queue.value.items[0], services.recordingCovers.value)).toBe("/api/v1/media/chosen");
    services.clear();
    expect(trackCover(source, services.recordingCovers.value)).toBe("/api/v1/media/old");
  });
});
