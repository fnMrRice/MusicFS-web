import { describe, expect, it } from "vitest";
import { loadFadePreferences } from "../../src/app/fade-preferences";

describe("saved fade preferences", () => {
  it.each([
    [true, true, true, 850, 850],
    [true, false, true, 850, 0],
    [false, true, true, 0, 850],
    [false, false, false, 850, 850],
  ] as const)("migrates track %s and seek %s from the shared duration", (track, seek, enabled, trackMs, seekMs) => {
    expect(loadFadePreferences({ trackFadeEnabled: track, seekFadeEnabled: seek, fadeDurationMs: 850 }))
      .toEqual({ enabled, trackMs, seekMs, pauseMs: 300 });
  });

  it("prefers the saved per-action durations, including zero", () => {
    const fades = { enabled: false, trackMs: 0, pauseMs: 200, seekMs: 1400 };
    expect(loadFadePreferences({ fades, fadeEnabled: true, fadeDurationMs: 600 })).toEqual(fades);
  });
});
