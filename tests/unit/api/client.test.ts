import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, errorMessage } from '../../../src/api/client';

describe('API boundary (Mock fetch)', () => {
  it('normalizes a structured unauthorized response and clears identity', async () => {
    const client = new ApiClient(vi.fn(async () => new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Auth required', requestId: 'r1' } }), { status: 401 })));
    client.onUnauthorized = vi.fn();
    await expect(client.request('/auth/session')).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401, requestId: 'r1' });
    expect(client.onUnauthorized).toHaveBeenCalledOnce();
  });
  it('sends CSRF and stable idempotency key but never retries a mutation automatically', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 })); const client = new ApiClient(fetcher);
    client.csrfToken = 'csrf'; await client.request('/test', { method: 'POST', body: {}, idempotencyKey: 'key' });
    expect(fetcher).toHaveBeenCalledOnce();
    const options = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1];
    expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('csrf');
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('key');
    expect(options.credentials).toBe('same-origin');
  });
  it('distinguishes deliberate cancellation from network failure', async () => {
    const controller = new AbortController(); controller.abort();
    const client = new ApiClient(vi.fn(async () => { throw new TypeError('failed'); }));
    await expect(client.request('/test', { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(client.request('/test')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  it('does not expose server error details that could contain secrets', () => {
    expect(errorMessage(new ApiError('HTTP_ERROR', 'secret=bootstrap', 500))).not.toContain('bootstrap');
  });
});
