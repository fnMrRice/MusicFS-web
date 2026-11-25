import { instanceIds } from "../../fixtures/plugins";
import { describe, expect, it, vi } from 'vitest';
import { LibraryState } from '../../../src/library/state';
import { ApiError } from '../../../src/api/client';
import type { MusicTrackPage } from '../../../src/api/music-catalog';
import { deferred, page } from '../../fixtures/dto';

describe('Library revision state (Mock pages)', () => {
  it('reads each incoming track identity once across twenty 100-track pages', async () => {
    let reads = 0;
    const track = page('sample').items[0];
    const state = new LibraryState(async (_provider, cursor) => {
      const offset = Number(cursor);
      return {
        ...page('sample'),
        nextAfter: offset < 1900 ? String(offset + 100) : null,
        items: Array.from({ length: 100 }, (_, index) => ({
          ...track,
          get trackId() { ++reads; return String(offset + index); },
        })),
      };
    });
    await state.select(instanceIds.local);
    while (state.snapshot.cursor && !state.snapshot.error) await state.more();
    expect(state.snapshot.items).toHaveLength(2000);
    expect(reads).toBe(2000);
  });
  it('discards an old page after a new refresh', async () => {
    const old = deferred<MusicTrackPage>(); const fresh = deferred<MusicTrackPage>();
    const received = vi.fn();
    const state = new LibraryState(vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise), received);
    const first = state.select(instanceIds.local); const second = state.refresh();
    fresh.resolve(page('fresh')); await second; old.resolve(page('old')); await first;
    expect(state.snapshot.items[0].trackId).toBe('fresh');
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0][0].trackId).toBe('fresh');
  });
  it('refresh wins against a late load-more and preserves nullable metadata', async () => {
    const more = deferred<MusicTrackPage>();
    const state = new LibraryState(vi.fn().mockResolvedValueOnce(page('one', 'next')).mockReturnValueOnce(more.promise).mockResolvedValueOnce(page('fresh')));
    await state.select(instanceIds.local); const second = state.more(); await state.refresh(); more.resolve(page('old')); await second;
    expect(state.snapshot.items).toHaveLength(1); expect(state.snapshot.items[0].selectedSource?.bitrateBps).toBeNull();
    expect(state.snapshot.items[0].trackId).toBe('fresh');
  });
  it('requires explicit refresh on expired cursors instead of merging revisions', async () => {
    const load = vi.fn().mockResolvedValueOnce(page('one', 'next')).mockRejectedValueOnce(new ApiError('CURSOR_EXPIRED', 'expired')).mockResolvedValueOnce(page('new', null, '2'));
    const state = new LibraryState(load); await state.select(instanceIds.local); await state.more();
    expect(state.snapshot.revision).toBe('1'); expect(state.snapshot.items[0].trackId).toBe('one');
    expect(state.snapshot.error).toContain('请刷新'); expect(load).toHaveBeenCalledTimes(2);
    await state.refresh();
    expect(state.snapshot.revision).toBe('2'); expect(state.snapshot.items[0].trackId).toBe('new');
    expect(load.mock.calls[2][1]).toBeNull();
  });
  it('blocks non-advancing cursors and concurrent appends', async () => {
    const pending = deferred<MusicTrackPage>();
    const load = vi.fn().mockResolvedValueOnce(page('one', 'next')).mockReturnValueOnce(pending.promise);
    const state = new LibraryState(load); await state.select(instanceIds.local);
    const first = state.more(); await state.more(); expect(load).toHaveBeenCalledTimes(2);
    pending.resolve(page('two', 'next')); await first;
    expect(state.snapshot.items.map(t => t.trackId)).toEqual(['one']);
    expect(state.snapshot.error).toContain('未能继续加载');
  });
  it('retains the last successful library on an offline error', async () => {
    const state = new LibraryState(vi.fn().mockResolvedValueOnce(page('one')).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline')));
    await state.select(instanceIds.local); await state.refresh();
    expect(state.snapshot.items).toHaveLength(1); expect(state.snapshot.stale).toBe(true);
  });
  it('can still append to the previous snapshot after a failed refresh', async () => {
    const load = vi.fn().mockResolvedValueOnce(page('one', 'next')).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page('two')).mockResolvedValueOnce(page('fresh'));
    const state = new LibraryState(load);
    await state.select(instanceIds.local);
    await state.refresh();
    await state.more();
    expect(state.snapshot.items.map((item) => item.trackId)).toEqual(['one', 'two']);
    await state.refresh();
    expect(state.snapshot.items.map((item) => item.trackId)).toEqual(['fresh']);
  });
});
