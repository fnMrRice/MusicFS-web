import { describe, expect, it, vi } from 'vitest';
import { ControlQueue } from '../../../src/player/control-queue';
import { ApiError } from '../../../src/api/client';
import type { Playback } from '../../../src/api/types';
import { deferred, playback } from '../../fixtures/dto';
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('Serialized controls (Mock transport)', () => {
  it('coalesces pending seeks and confirms intermediate attempts before issuing the next request', async () => {
    const first = deferred<Playback>(); const second = deferred<Playback>();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); const confirm = vi.fn();
    const queue = new ControlQueue(playback(), send, confirm, vi.fn());
    queue.seek(1000); queue.seek(2000); queue.seek(3000); expect(send).toHaveBeenCalledOnce();
    first.resolve(playback('a2')); await flush();
    expect(confirm).toHaveBeenNthCalledWith(1, playback('a2'), false);
    expect(send.mock.calls[1][0].attemptId).toBe('a2'); expect(send.mock.calls[1][1].positionMs).toBe(3000);
    expect(send.mock.calls[0][2]).not.toBe(send.mock.calls[1][2]);
    second.resolve(playback('a3')); await flush(); expect(confirm).toHaveBeenLastCalledWith(playback('a3'), true);
  });
  it('reuses the same key and expected attempt when a response is lost', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'lost')).mockResolvedValueOnce(playback('a2'));
    const confirm = vi.fn(); const queue = new ControlQueue(playback(), send, confirm, vi.fn()); queue.seek(1000); await flush();
    expect(send.mock.calls[0][2]).toBe(send.mock.calls[1][2]); expect(send.mock.calls[1][0].attemptId).toBe('a1'); expect(confirm).toHaveBeenCalledOnce();
  });
  it('stops the queue when repeated confirmation is still uncertain', async () => {
    const send = vi.fn().mockRejectedValue(new ApiError('TIMEOUT', 'lost')); const fail = vi.fn();
    const queue = new ControlQueue(playback(), send, vi.fn(), fail); queue.seek(1000); queue.seek(2000); await flush(); queue.seek(3000);
    expect(send).toHaveBeenCalledTimes(2); expect(fail).toHaveBeenCalledWith(expect.objectContaining({ code: 'OUTCOME_UNKNOWN' }));
  });
  it('serializes recovery and seek, deduplicates failure, and never uses an old attempt', async () => {
    const first = deferred<Playback>(); const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(playback('a3'));
    const queue = new ControlQueue(playback(), send, vi.fn(), vi.fn());
    queue.recover(1000, { code: 'MEDIA_ERROR', message: 'failure' }); queue.recover(1000, { code: 'MEDIA_ERROR', message: 'failure' }); queue.seek(3000);
    expect(send).toHaveBeenCalledOnce(); first.resolve(playback('a2')); await flush();
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0].attemptId).toBe('a2');
  });
  it('disposal ignores old control results after a song switch', async () => {
    const response = deferred<Playback>(); const confirm = vi.fn(); const send = vi.fn().mockReturnValue(response.promise);
    const queue = new ControlQueue(playback(), send, confirm, vi.fn()); queue.seek(1000); queue.dispose(); response.resolve(playback('a2')); await flush();
    expect(confirm).not.toHaveBeenCalled(); expect(send.mock.calls[0][3].aborted).toBe(true);
  });
});
