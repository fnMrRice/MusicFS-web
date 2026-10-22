import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordingCovers, trackCover } from "../../src/app/recording-covers";
import { Services } from "../../src/app/services";
import { track } from "../fixtures/dto";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Recording artwork metadata", () => {
  it("uses server-confirmed artwork without mutating source candidates and keeps explicit empty selection", () => {
    const covers = new RecordingCovers();
    const source = { ...track, recordingId: "recording", coverObjectId: "small" };
    const group = { ...source, coverObjectId: "large", versions: [source] };
    expect(trackCover(group, covers.value)).toBe("large");
    covers.update("recording", "selected", [group]);
    expect(trackCover(group, covers.value)).toBe("selected");
    expect(group.versions[0].coverObjectId).toBe("small");
    expect(trackCover({ ...group, coverObjectId: "newer" }, covers.value)).toBe("newer");
    covers.update("recording", null, [group]);
    expect(trackCover(group, covers.value)).toBeNull();
    covers.clear();
    expect(trackCover(group, covers.value)).toBe("large");
  });

  it("reconciles old queue objects after automatic selection changes or a source leaves the recording", () => {
    const covers = new RecordingCovers();
    const source = { ...track, recordingId: "recording", coverObjectId: "small" };
    covers.update("recording", "large", [source]);
    covers.reconcile([{ ...source, coverObjectId: "larger" }], [source]);
    expect(trackCover(source, covers.value)).toBe("larger");
    covers.reconcile([{ ...source, recordingId: null, coverObjectId: "small" }], [source]);
    expect(trackCover(source, covers.value)).toBe("small");
    covers.update("recording", "other-member", [source]);
    expect(trackCover(source, covers.value)).toBe("small");
    covers.reconcile([{ ...source, recordingId: null, coverObjectId: null }], [source]);
    expect(trackCover(source, covers.value)).toBeNull();
  });

  it("recognizes a queued source candidate without recording metadata and later uses its group's new artwork", () => {
    const covers = new RecordingCovers();
    const source = { ...track, coverObjectId: "small" };
    covers.update("recording", "selected", [source], [source.sourceTrackId]);
    expect(trackCover(source, covers.value)).toBe("selected");
    covers.reconcile([{ ...source, sourceTrackId: "representative", recordingId: "recording", coverObjectId: "larger", versions: [source] }], [source]);
    expect(trackCover(source, covers.value)).toBe("larger");
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
    expect(trackCover(services.queue.value.items[0], services.recordingCovers.value)).toBe("chosen");
    services.clear();
    expect(trackCover(source, services.recordingCovers.value)).toBe("old");
  });
});
