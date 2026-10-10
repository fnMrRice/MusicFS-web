import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanStatusMessage } from '../../../src/library/scan-state';
import { scanFailureMessage, waitForScanJob } from '../../fixtures/scan-job';

describe('Scan status compatibility', () => {
  afterEach(() => vi.useRealTimers());

  it('explains automatic retry and terminal pause while retaining the library', () => {
    expect(scanStatusMessage({ availability: 'available', scanState: 'retry_wait' })).toContain('等待自动重试');
    expect(scanStatusMessage({ availability: 'offline', scanState: 'retry_wait' })).toContain('等待自动重试');
    const message = scanStatusMessage({ availability: 'offline', scanState: 'paused' });
    expect(message).toContain('不会自动继续'); expect(message).toContain('重新提交扫描');
    expect(message).toContain('保留上次成功扫描');
    expect(scanStatusMessage({ availability: 'available', scanState: 'running' })).toContain('尚未完成');
    expect(scanStatusMessage({ availability: 'available', scanState: 'succeeded' })).toBeNull();
  });

  it('keeps polling retry_wait and running despite a retained last failure', async () => {
    vi.useFakeTimers();
    const error = { code: 'TEMPORARY_FAILURE', message: 'Synthetic transient failure' };
    const load = vi.fn().mockResolvedValueOnce({ status: 'retry_wait', error })
      .mockResolvedValueOnce({ status: 'running', error }).mockResolvedValueOnce({ status: 'succeeded', error: null });
    const onRetry = vi.fn(); const pending = waitForScanJob(load, { timeoutMs: 1000, pollMs: 100, onRetry });
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending).status).toBe('succeeded'); expect(load).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('stops immediately for a paused job and requires an explicit new submission', async () => {
    const job = { status: 'paused', error: { code: 'SOURCE_OFFLINE', message: 'Synthetic offline source' } };
    const load = vi.fn().mockResolvedValue(job);
    expect(await waitForScanJob(load)).toEqual(job); expect(load).toHaveBeenCalledTimes(1);
    expect(scanFailureMessage(job)).toContain('new idempotency key');
  });

  it('retains a fixed wait deadline across retries', async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue({ status: 'retry_wait', error: { code: 'RATE_LIMITED', message: 'Synthetic limit' } });
    const pending = waitForScanJob(load, { timeoutMs: 250, pollMs: 100 });
    const result = expect(pending).rejects.toThrow('Scan wait timed out');
    await vi.advanceTimersByTimeAsync(250); await result;
    expect(load).toHaveBeenCalledTimes(3); expect(load.mock.calls.map(([timeout]) => timeout)).toEqual([250, 150, 50]);
  });
});
