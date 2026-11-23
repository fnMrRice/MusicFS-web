import { instanceIds } from "../../fixtures/plugins";
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../src/api/client';
import { ContentApi } from '../../../src/api/content';

describe('Content adapters follow current Server contracts', () => {
  it('reads account playlists with the original instance and opaque cursor and validates list consistency', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null, consistency: 'unversioned', observedAt: '2026-10-10T08:00:00Z' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null })));
    const api = new ContentApi(new ApiClient(fetcher));
    await api.accountPlaylists(instanceIds.custom, 'opaque/next+page');
    const url = new URL(fetcher.mock.calls[0][0], 'https://example.test');
    expect(url.pathname).toBe(`/api/v1/online-instances/${instanceIds.custom}/playlists`);
    expect(url.searchParams.get('cursor')).toBe('opaque/next+page');
    expect(url.searchParams.get('limit')).toBe('30');
    await expect(api.accountPlaylists(instanceIds.custom, null)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('reads the sync job after the accepted receipt instead of treating it as completion', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job', merged: false }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job', state: 'running', resultRevision: null, error: null })));
    const client = new ApiClient(fetcher); client.csrfToken = 'csrf'; const api = new ContentApi(client);
    const receipt = await api.sync({ playlistId: 'p', instanceId: instanceIds.custom, externalId: '123', title: 'name', bindingRevision: 3, revision: 1, stale: true, lastSuccessAt: null, error: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const result = await api.syncJob(receipt.jobId);
    expect(result.state).toBe('running'); expect(fetcher.mock.calls[0][0]).toBe('/api/v1/remote-playlists/p/sync-jobs');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ expectedBindingRevision: 3 });
    expect(fetcher.mock.calls[0][1].headers.get('X-CSRF-Token')).toBe('csrf');
    expect(fetcher.mock.calls[1][0]).toBe('/api/v1/remote-playlist-sync-jobs/job');
  });
  it('keeps instance, keyword and opaque cursor bound on search append', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tracks: [], nextCursor: null, truncated: false })));
    await new ContentApi(new ApiClient(fetcher)).search(instanceIds.netease, '中文 & title', 'opaque.token');
    const url = new URL(fetcher.mock.calls[0][0], 'https://example.test');
    expect(url.pathname).toBe(`/api/v1/online-instances/${instanceIds.netease}/search`);
    expect(url.searchParams.get('q')).toBe('中文 & title'); expect(url.searchParams.get('cursor')).toBe('opaque.token');
    expect(url.searchParams.has('type')).toBe(false);
  });
  it('rejects a snapshot from another revision', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], revision: 2, nextOffset: null })));
    await expect(new ContentApi(new ApiClient(fetcher)).snapshot('p', 1, 0)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('replays uncertain writes with the same idempotency key', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Network failure')).mockResolvedValueOnce(new Response(JSON.stringify({ playlistId: 'p', name: 'Test', ruleRevision: 1, bindings: [] })));
    await new ContentApi(new ApiClient(fetcher)).create('Test');
    expect(fetcher.mock.calls[0][1].headers.get('Idempotency-Key')).toBe(fetcher.mock.calls[1][1].headers.get('Idempotency-Key'));
  });
});
