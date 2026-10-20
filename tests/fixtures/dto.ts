import type { Playback, SourceTrack, TrackPage } from '../../src/api/types';
import { instanceIds } from './plugins';
export const track: SourceTrack = {
  sourceTrackId: 'track-1', providerInstanceId: instanceIds.local, displayName: '中文 <sample>.wav',
  title: null, artists: [], durationMs: 30_000, codec: 'pcm_s16le', container: 'wav', bitrateBps: null,
  availability: 'available', assetId: 'asset-1',
};
export const page = (id: string, cursor: string | null = null, revision = '1'): TrackPage => ({
  items: [{ ...track, sourceTrackId: id }], nextCursor: cursor, libraryRevision: revision,
});
export const playback = (attemptId = 'a1'): Playback => ({
  sessionId: 'session-1', attemptId, assetId: 'asset-1', representationId: `rep-${attemptId}`,
  deliveryMode: 'direct', outputProfile: { mime: 'audio/wav', codec: 'pcm_s16le', container: 'wav', transport: 'htmlAudio' },
  streamUrl: `/api/v1/playback/sessions/session-1/attempts/${attemptId}/stream`, expiresAt: '2099-01-01T00:00:00Z',
  seekMode: 'byteRange', seekableRange: { startMs: 0, endMs: 30_000 }, positionOriginMs: 0,
  effectiveProcessing: [], resumeDecision: 'continue',
});
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
