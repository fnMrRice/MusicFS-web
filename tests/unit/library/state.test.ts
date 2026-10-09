import { describe, expect, it, vi } from 'vitest';
import { LibraryState } from '../../../src/library/state';
import { ApiError } from '../../../src/api/client';
import type { TrackPage } from '../../../src/api/types';
import { deferred, page } from '../../fixtures/dto';

describe('Library revision state (Mock pages)', () => {
  it('discards an old page after a new refresh', async () => {
    const old = deferred<TrackPage>(); const fresh = deferred<TrackPage>();
    const state = new LibraryState(vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise));
    const first = state.select('local'); const second = state.refresh();
    fresh.resolve(page('fresh')); await second; old.resolve(page('old')); await first;
    expect(state.snapshot.items[0].sourceTrackId).toBe('fresh');
  });
  it('refresh wins against a late load-more and preserves nullable metadata', async () => {
    const more = deferred<TrackPage>();
    const state = new LibraryState(vi.fn().mockResolvedValueOnce(page('one', 'next')).mockReturnValueOnce(more.promise).mockResolvedValueOnce(page('fresh')));
    await state.select('local'); const second = state.more(); await state.refresh(); more.resolve(page('old')); await second;
    expect(state.snapshot.items).toHaveLength(1); expect(state.snapshot.items[0].bitrateBps).toBeNull();
    expect(state.snapshot.items[0].sourceTrackId).toBe('fresh');
  });
  it('restarts on expired cursors instead of merging revisions', async () => {
    const load = vi.fn().mockResolvedValueOnce(page('one', 'next')).mockRejectedValueOnce(new ApiError('CURSOR_EXPIRED', 'expired')).mockResolvedValueOnce(page('new', null, '2'));
    const state = new LibraryState(load); await state.select('local'); await state.more();
    expect(state.snapshot.revision).toBe('2'); expect(state.snapshot.items[0].sourceTrackId).toBe('new');
    expect(load.mock.calls[2][1]).toBeNull();
  });
  it('retains the last successful library on an offline error', async () => {
    const state = new LibraryState(vi.fn().mockResolvedValueOnce(page('one')).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline')));
    await state.select('local'); await state.refresh();
    expect(state.snapshot.items).toHaveLength(1); expect(state.snapshot.stale).toBe(true);
  });
});
