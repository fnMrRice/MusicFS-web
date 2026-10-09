import { expect, it } from 'vitest';
import { seekAllowed, trackPosition } from '../../../src/player/timeline';
import { playback } from '../../fixtures/dto';
it('maps fragment time to track milliseconds and validates finite ranges', () => {
  const value = { ...playback(), positionOriginMs: 12_000 };
  expect(trackPosition(value, 1.25)).toBe(13_250);
  expect(seekAllowed(value, 30_001)).toBe(false); expect(seekAllowed(value, NaN)).toBe(false);
  expect(seekAllowed(value, 20_000)).toBe(true); expect(seekAllowed({ ...value, seekMode: 'none' }, 0)).toBe(false);
});
