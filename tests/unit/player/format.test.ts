import { describe, expect, it } from "vitest";
import { playbackFormat, playbackFormatTitle } from "../../../src/player/format";
import { tr } from "../../../src/i18n";
import { playback, track } from "../../fixtures/dto";
import type { Playback } from "../../../src/api/types";

const online = { ...track, container: null, codec: null, bitrateBps: null,
  downloadVersions: [{ versionId: "v1", codec: "aac", mime: "audio/mp4", container: "m4a", quality: "high",
    bitrateBps: 128000, sizeBytes: 900, downloadedAt: "" }] };
function proxy(codec: string | null, container: string | null, mime: string, bitrateBps?: number): Playback {
  return { ...playback(), deliveryMode: "proxy", outputProfile: { codec, container, mime, transport: "htmlAudio", bitrateBps } };
}

describe("playing format", () => {
  it("identifies measured downloads before playback and displays only the playing file's depth and format", () => {
    const first = { ...online.downloadVersions[0], sampleRateHz: 44100, channels: 2, formatMeasured: true };
    const one = { ...online, downloadVersions: [first] };
    expect(playbackFormat(one, null)).toContain("M4A → AAC · 44.1 kHz · 128 kbps");
    const multiple = { ...one, downloadVersions: [first, { ...first, versionId: "flac", codec: "flac", container: "flac", bitDepth: 24 }] };
    expect(playbackFormat(multiple, null)).toContain("M4A → AAC / FLAC");
    const active = proxy("flac", "flac", "audio/flac", 805500);
    active.outputProfile = { ...active.outputProfile, sampleRate: 48000, channels: 6, bitDepth: 16 };
    expect(playbackFormat(multiple, active)).toBe(["FLAC", "48 kHz", "805.5 kbps", tr("{0} 声道", { 0: 6 }), "16 bit"].join(" · "));
  });
  it("uses the current representation across quality changes without guessing from downloads or stale catalog values", () => {
    const stale = { ...online, codec: "mp3", container: "mp3", bitrateBps: 320000 };
    expect(playbackFormat(online, null)).toBe(tr("编码未知"));
    const flac = proxy("flac", "flac", "audio/flac", 900000);
    const aac = proxy("aac", "m4a", "audio/mp4", 128000);
    expect(playbackFormat(stale, flac).split(" · ")[0]).toBe("FLAC");
    expect(playbackFormatTitle(stale, flac)).not.toContain("320 kbps");
    expect(playbackFormatTitle(stale, flac)).toContain("900 kbps");
    expect(playbackFormat(online, aac).split(" · ")[0]).toBe("M4A → AAC");
    expect(playbackFormat(online, proxy(null, null, "audio/ogg")).split(" · ")[0]).toBe("OGG");
  });

  it("uses the session source and asset for processed or unwrapped audio in a multi-source track", () => {
    const ncm = { ...track, sourceTrackId: "ncm", assetId: "different", container: "ncm", codec: "flac", bitrateBps: 600000 };
    const group = { ...track, bitrateBps: 100000, versions: [track, ncm] };
    const output = { ...proxy("mp3", "mp3", "audio/mpeg", 192000), sourceTrackId: ncm.sourceTrackId, assetId: ncm.assetId };
    expect(playbackFormatTitle(group, { ...output, deliveryMode: "processed" })).toContain("NCM → FLAC → MP3");
    expect(playbackFormatTitle(group, { ...output, deliveryMode: "processed" })).toContain("600 kbps");
    expect(playbackFormat(group, { ...output, assetId: "replaced", deliveryMode: "processed" }).split(" · ")[0]).toBe("MP3");
    const unwrapped = { ...proxy("flac", "flac", "audio/flac"), sourceTrackId: "ncm", assetId: "different",
      effectiveProcessing: [{ type: "ncmDecrypt" }] };
    expect(playbackFormat(group, unwrapped).split(" · ")[0]).toBe("NCM → FLAC");
  });
});
