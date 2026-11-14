import { ApiClient, ApiError } from './client';
import type { Capabilities, ObservedError, Playback, Preferences } from './types';

export function validatePlayback(value: Playback): Playback {
  if (!value || typeof value.sourceTrackId !== 'string' || !value.sourceTrackId || typeof value.sessionId !== 'string' || typeof value.attemptId !== 'string'
    || !['client', 'server'].includes(value.dspExecution)
    || typeof value.assetId !== 'string' || typeof value.representationId !== 'string'
    || typeof value.streamUrl !== 'string' || !value.streamUrl.startsWith('/api/v1/') || value.streamUrl.startsWith('//')
    || !['direct', 'proxy', 'processed'].includes(value.deliveryMode) || !['byteRange', 'timeRestart', 'none'].includes(value.seekMode)
    || !Number.isFinite(value.positionOriginMs) || !value.outputProfile || typeof value.outputProfile.mime !== 'string'
    || !['continue', 'restartRequired', 'unavailable'].includes(value.resumeDecision)
    || !Array.isArray(value.effectiveProcessing)
    || (value.seekableRange !== null && (!value.seekableRange || !Number.isFinite(value.seekableRange.startMs) || !Number.isFinite(value.seekableRange.endMs))))
    throw new ApiError('INVALID_RESPONSE', 'Invalid playback descriptor');
  return value;
}
export class PlaybackApi {
  constructor(private client: ApiClient) {}
  async create(sourceTrackId: string, capabilities: Capabilities, preferences: Preferences, key: string, signal?: AbortSignal, selection?: { trackId: string; forcedSourceTrackId: string | null }): Promise<Playback> {
    return validatePlayback(await this.client.control('/playback/sessions', {
      method: 'POST', body: { trackId: selection?.trackId, forcedSourceTrackId: selection?.forcedSourceTrackId ?? undefined, sourceTrackId, capabilities, preferences }, idempotencyKey: key, signal,
      onLateSuccess: (value) => {
        try { void this.close(validatePlayback(value as Playback).sessionId).catch(() => {}); }
        catch { /* 无效描述不能触发资源删除。 */ }
      },
    }));
  }
  async control(sessionId: string, kind: 'seek' | 'recover', attemptId: string, positionMs: number, key: string, observedError?: ObservedError, signal?: AbortSignal): Promise<Playback> {
    // 协议接收整数毫秒；浏览器 currentTime 可能包含亚毫秒精度。
    const integerPositionMs = Math.round(positionMs);
    if (positionMs < 0 || !Number.isSafeInteger(integerPositionMs))
      throw new ApiError('INVALID_ARGUMENT', 'Playback position must be finite, nonnegative and safely representable');
    return validatePlayback(await this.client.control(`/playback/sessions/${encodeURIComponent(sessionId)}/${kind}`, {
      method: 'POST', body: { attemptId, positionMs: integerPositionMs, ...(observedError ? { observedError } : {}) }, idempotencyKey: key, signal,
    }));
  }
  async close(sessionId: string): Promise<void> {
    await this.client.control(`/playback/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  }
}
