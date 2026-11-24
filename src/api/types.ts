import type { CatalogAlbum, CatalogArtist } from "./music-catalog";

export interface PluginIdentity {
  id: string; name: string; localizedNames: Record<string, string>; features: string[];
}
export interface Ready { product: string; instanceId: string; serverVersion: string; apiVersion: string; ready: boolean }
export interface AuthSession { user: { id: string; role: string }; csrfToken: string; expiresAt: string }
export interface Provider {
  id: string; name: string; capabilities: string[]; availability: string; scanState?: string;
  sourceType?: "local" | "network";
  accountState?: "notRequired" | "authorized" | "authRequired";
  plugin?: PluginIdentity;
  configuration?: { schemaRevision: string } | null;
  roots?: { id: string; name: string }[];
}
export interface DownloadVersion {
  versionId: string; quality: string; mime: string; codec: string; container: string;
  sizeBytes: number; bitrateBps?: number; downloadedAt: string;
  sampleRateHz?: number; channels?: number; bitDepth?: number; formatMeasured?: boolean;
}
export interface SourceTrack {
  sourceTrackId: string; providerInstanceId: string; displayName: string;
  title: string | null; artists: string[] | null; durationMs: number | null;
  album?: string | null; genre?: string | null; coverObjectId?: string | null;
  onlineCoverPath?: string | null;
  /** 将规范曲目投影为播放项时保留的封面。 */
  catalogCoverPath?: string;
  albums?: CatalogAlbum[]; catalogArtists?: CatalogArtist[];
  codec: string | null; container: string | null; bitrateBps: number | null;
  sampleRateHz?: number | null;
  availability: string; assetId: string | null; recordingId?: string | null;
  asset?: { fileSizeBytes?: number | null } | null;
  manualSourceTrackId?: string | null;
  downloaded?: boolean;
  downloadVersions?: DownloadVersion[];
  versions?: SourceTrack[];
  playbackSelection?: { trackId: string; forcedSourceTrackId: string | null };
}
export interface TrackPage { items: SourceTrack[]; nextCursor: string | null; libraryRevision: string }
export interface OutputProfile { mime: string; codec: string | null; container: string | null; transport: string; channels?: number; layout?: string; sampleRate?: number; bitrateBps?: number | null; bitDepth?: number }
export interface Playback {
  sourceTrackId: string;
  sessionId: string; attemptId: string; assetId: string; representationId: string;
  dspExecution: 'server' | 'client';
  deliveryMode: 'direct' | 'proxy' | 'processed'; outputProfile: OutputProfile; outputProfilePending?: boolean;
  streamUrl: string; expiresAt: string; seekMode: 'byteRange' | 'timeRestart' | 'none';
  seekableRange: { startMs: number; endMs: number; growing?: boolean } | null;
  positionOriginMs: number; effectiveProcessing: unknown[];
  resumeDecision: 'continue' | 'restartRequired' | 'unavailable';
}
export interface Capabilities {
  htmlAudio: true; formats: { mime: string; canPlay: CanPlayTypeResult }[];
}
export interface Preferences { forceProcessing: boolean; gainDb: number; dspExecution?: 'server' | 'client' }
export interface ObservedError { code: string; message: string; outputProfile?: OutputProfile }
