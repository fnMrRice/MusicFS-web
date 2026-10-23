import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../src/api/client';
import { PlaybackApi } from '../../../src/api/playback';
import type { ObservedError, Playback } from '../../../src/api/types';
import type { AudioPort, MediaObservation } from '../../../src/player/audio-adapter';
import { PlayerController } from '../../../src/player/controller';
import { playback, track } from '../../fixtures/dto';

interface ControlBody { attemptId: string; positionMs: number; observedError?: ObservedError }
const observedError = { code: 'MEDIA_ERROR_2', message: 'Browser observed media failure' };

function setup(overrides: Partial<Playback> = {}) {
  const requests: { path: string; body: ControlBody }[] = [];
  const observations: ((event: MediaObservation) => void)[] = [];
  let current = { ...playback(), ...overrides };
  let created = 0;
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    const path = String(input);
    if (options?.method === 'DELETE') return new Response(null, { status: 204 });
    if (path.endsWith('/sessions')) {
      current = { ...playback(`initial-${++created}`), ...overrides, sessionId: `session-${created}` };
      return Response.json(current);
    }
    const body = JSON.parse(String(options?.body)) as ControlBody;
    requests.push({ path, body });
    // 模拟服务端整数毫秒契约，检查真正序列化后的 HTTP 请求。
    if (!Number.isSafeInteger(body.positionMs) || body.positionMs < 0)
      return Response.json({ error: { code: 'INVALID_ARGUMENT', message: 'Invalid position' } }, { status: 400 });
    current = { ...current, attemptId: `controlled-${requests.length}`, positionOriginMs: body.positionMs };
    return Response.json(current);
  });
  const client = new ApiClient(fetcher);
  // 此测试显式注入命令边界，生产环境不允许 HTTP 回退。
  client.controlTransport = { request: client.request.bind(client) };
  const api = new PlaybackApi(client);
  const audio: AudioPort = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), destroy: vi.fn(),
    seek: vi.fn(), seconds: 0, seekable: [{ start: 0, end: 300 }] };
  const controller = new PlayerController(api, (_url, observe) => {
    observations.push(observe);
    return audio;
  }, { htmlAudio: true, formats: [] });
  return { api, controller, fetcher, requests, observations,
    event(type: MediaObservation['type'], seconds: number) {
      observations.at(-1)!({ type, seconds, paused: false, errorCode: 2 });
    } };
}

afterEach(() => vi.useRealTimers());

describe('Playback controls through the injected command boundary', () => {
  it.each([
    { deliveryMode: 'direct' as const, positionOriginMs: 0, seconds: 151.438367, expected: 151438 },
    { deliveryMode: 'processed' as const, positionOriginMs: 120000, seconds: 31.438867, expected: 151439 },
    { deliveryMode: 'proxy' as const, positionOriginMs: 45000, seconds: 106.438367, expected: 151438 },
  ])('recovers $deliveryMode audio from fractional media time at the absolute track position', async (sample) => {
    const s = setup({ deliveryMode: sample.deliveryMode, positionOriginMs: sample.positionOriginMs });
    try {
      await s.controller.select(track);
      s.event('playing', 0);
      s.event('error', sample.seconds);
      await vi.waitFor(() => expect(s.controller.state.playback?.attemptId).toBe('controlled-1'));
      expect(s.requests).toEqual([{ path: '/api/v1/playback/sessions/session-1/recover', body: {
        attemptId: 'initial-1', positionMs: sample.expected,
        observedError: { ...observedError, outputProfile: playback().outputProfile },
      } }]);
      expect(s.controller.state.positionMs).toBe(sample.expected);
      expect(s.controller.state.message).toBeNull();
    } finally { s.controller.stop(); }
  });

  it('recovers a buffering timeout with fractional currentTime and a nonzero stream origin', async () => {
    vi.useFakeTimers();
    const s = setup({ deliveryMode: 'processed', positionOriginMs: 120000 });
    try {
      await s.controller.select(track);
      s.event('playing', 0);
      s.event('waiting', 31.438867);
      await vi.advanceTimersByTimeAsync(10000);
      expect(s.requests[0]).toMatchObject({ body: { positionMs: 151439,
        observedError: { code: 'BUFFERING_TIMEOUT' } } });
      expect(s.controller.state.playback?.attemptId).toBe('controlled-1');
      expect(s.controller.state.message).toBeNull();
    } finally { s.controller.stop(); }
  });

  it('ignores old media failures after switching sources and recovers only the new session', async () => {
    const s = setup();
    try {
      await s.controller.select(track);
      const stale = s.observations[0];
      await s.controller.select({ ...track, sourceTrackId: 'other-source-track', providerInstanceId: 'other-source' });
      stale({ type: 'error', seconds: 151.438367, paused: false, errorCode: 2 });
      expect(s.requests).toHaveLength(0);
      s.event('error', 2.345678);
      await vi.waitFor(() => expect(s.controller.state.playback?.attemptId).toBe('controlled-1'));
      expect(s.requests).toEqual([{ path: '/api/v1/playback/sessions/session-2/recover', body: {
        attemptId: 'initial-2', positionMs: 2346,
        observedError: { ...observedError, outputProfile: playback().outputProfile },
      } }]);
    } finally { s.controller.stop(); }
  });

  it('submits a fractional programmatic seek as integer milliseconds and resumes at the accepted position', async () => {
    const s = setup({ deliveryMode: 'processed', seekMode: 'timeRestart' });
    try {
      await s.controller.select(track);
      s.controller.seek(12345.678);
      await vi.waitFor(() => expect(s.controller.state.playback?.attemptId).toBe('controlled-1'));
      expect(s.requests).toEqual([{ path: '/api/v1/playback/sessions/session-1/seek',
        body: { attemptId: 'initial-1', positionMs: 12346 } }]);
      expect(s.controller.state.positionMs).toBe(12346);
    } finally { s.controller.stop(); }
  });

  it.each(['seek', 'recover'] as const)('normalizes positions for direct API %s callers', async (kind) => {
    const s = setup();
    await s.api.control('session-1', kind, 'a1', 0.4, 'key', kind === 'recover' ? observedError : undefined);
    expect(s.requests[0].body.positionMs).toBe(0);
  });

  it.each(['seek', 'recover'] as const)('rejects invalid %s positions before sending a request', async (kind) => {
    const s = setup();
    for (const positionMs of [NaN, Infinity, -Infinity, -0.4, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(s.api.control('session-1', kind, 'a1', positionMs, 'key', observedError))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    expect(s.fetcher).not.toHaveBeenCalled();
  });
});
