export interface PluginIdentity {
  id: string; name: string; localizedNames: Record<string, string>; features: string[];
}
export interface Ready { product: string; instanceId: string; apiVersion: string; ready: boolean }
export interface AuthSession { user: { id: string; role: string }; csrfToken: string; expiresAt: string }
export interface Provider {
  id: string; name: string; capabilities: string[]; availability: string; scanState?: string;
  plugin?: PluginIdentity;
  configuration?: { schemaRevision: string } | null;
  roots?: { id: string; name: string }[];
}
export interface SourceTrack {
  sourceTrackId: string; providerInstanceId: string; displayName: string;
  title: string | null; artists: string[] | null; durationMs: number | null;
  codec: string | null; container: string | null; bitrateBps: number | null;
  availability: string; assetId: string | null; recordingId?: string | null;
  versions?: SourceTrack[];
}
export interface TrackPage { items: SourceTrack[]; nextCursor: string | null; libraryRevision: string; matchingRevision?: number }
export interface OutputProfile { mime: string; codec: string | null; container: string | null; transport: string; channels?: number; layout?: string; sampleRate?: number }
export interface Playback {
  sessionId: string; attemptId: string; assetId: string; representationId: string;
  dspExecution: 'server' | 'client';
  deliveryMode: 'direct' | 'proxy' | 'processed'; outputProfile: OutputProfile;
  streamUrl: string; expiresAt: string; seekMode: 'byteRange' | 'timeRestart' | 'none';
  seekableRange: { startMs: number; endMs: number } | null;
  positionOriginMs: number; effectiveProcessing: unknown[];
  resumeDecision: 'continue' | 'restartRequired' | 'unavailable';
}
export interface Capabilities {
  htmlAudio: true; formats: { mime: string; canPlay: CanPlayTypeResult }[];
}
export interface Preferences { forceProcessing: boolean; gainDb: number; dspExecution?: 'server' | 'client' }
export interface ObservedError { code: string; message: string; outputProfile?: OutputProfile }
