import { ApiClient, ApiError } from './client';
import type { Capabilities, ObservedError, Playback, Preferences } from './types';

export function validatePlayback(value: Playback): Playback {
  if (!value || typeof value.sessionId !== 'string' || typeof value.attemptId !== 'string'
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
  async create(sourceTrackId: string, capabilities: Capabilities, preferences: Preferences, key: string, signal?: AbortSignal): Promise<Playback> {
    return validatePlayback(await this.client.request('/playback/sessions', { method: 'POST', body: { sourceTrackId, capabilities, preferences }, idempotencyKey: key, signal }));
  }
  async control(sessionId: string, kind: 'seek' | 'recover', attemptId: string, positionMs: number, key: string, observedError?: ObservedError, signal?: AbortSignal): Promise<Playback> {
    return validatePlayback(await this.client.request(`/playback/sessions/${encodeURIComponent(sessionId)}/${kind}`, {
      method: 'POST', body: { attemptId, positionMs, ...(observedError ? { observedError } : {}) }, idempotencyKey: key, signal,
    }));
  }
  async close(sessionId: string): Promise<void> {
    await this.client.request(`/playback/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', keepalive: true });
  }
}
