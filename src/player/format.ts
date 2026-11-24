import type { DownloadVersion, OutputProfile, Playback, SourceTrack } from '../api/types';
import { tr } from '../i18n';

function codecName(codec: string | null | undefined): string | undefined {
  const value = codec?.trim();
  if (!value) return;
  const name = value.toLowerCase();
  if (name === 'pcm' || name === 'lpcm' || name.startsWith('pcm_')) return 'PCM';
  if (['eac3', 'e-ac-3', 'ec-3', 'ddp', 'dd+'].includes(name)) return 'DDP';
  if (['ac3', 'ac-3'].includes(name)) return 'DD';
  return value.toUpperCase();
}

function channelCount(output: OutputProfile): number | undefined {
  if (typeof output.channels === 'number' && Number.isInteger(output.channels) && output.channels > 0) return output.channels;
  const layouts: Record<string, number> = { mono: 1, stereo: 2, '5.1': 6, '5.1(side)': 6, '7.1': 8 };
  return layouts[output.layout?.toLowerCase() ?? ''];
}

export function bitrateLabel(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? `${Math.round(value / 100) / 10} kbps`
    : tr('码率未知');
}

export function sampleRateLabel(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? `${value / 1000} kHz`
    : tr('采样率未知');
}

export function versionParameters(version: DownloadVersion): string {
  return [version.sampleRateHz && sampleRateLabel(version.sampleRateHz), version.bitrateBps && bitrateLabel(version.bitrateBps),
    version.channels && tr('{0} 声道', { 0: version.channels }), version.bitDepth && `${version.bitDepth} bit`]
    .filter(Boolean).join(' · ');
}

function sessionSource(track: SourceTrack, playback: Playback | null): SourceTrack | undefined {
  if (!playback) return track;
  const matches = (item: SourceTrack) => item.sourceTrackId === playback.sourceTrackId &&
    (!item.assetId || item.assetId === playback.assetId);
  return matches(track) ? track : track.versions?.find(matches);
}

export function formatPair(container?: string | null, codec?: string | null): string | undefined {
  const outer = container?.trim().toUpperCase();
  const inner = codecName(codec);
  return outer && inner && outer !== inner ? `${outer} → ${inner}` : outer || inner;
}

function outputFormat(output: OutputProfile): string | undefined {
  const declared = formatPair(output.container, output.codec);
  if (declared) return declared;
  // MIME 只能说明容器时不推测其中的编码。
  const mime = output.mime.split(';')[0].trim().toLowerCase();
  const names: Record<string, string> = { 'audio/mpeg': 'MPEG', 'audio/flac': 'FLAC', 'audio/x-flac': 'FLAC',
    'audio/wav': 'WAV', 'audio/x-wav': 'WAV', 'audio/aac': 'AAC', 'audio/mp4': 'MP4',
    'audio/ogg': 'OGG', 'audio/opus': 'OPUS', 'audio/webm': 'WEBM' };
  return names[mime];
}

function formatChain(track: SourceTrack, playback: Playback | null): string {
  const source = sessionSource(track, playback);
  const input = formatPair(source?.container, source?.codec);
  if (!playback) return input ?? tr('编码未知');
  const output = outputFormat(playback.outputProfile);
  if (playback.deliveryMode === 'processed') {
    const final = codecName(playback.outputProfile.codec) ?? output;
    return [input, final].filter(Boolean).join(' → ') || tr('编码未知');
  }
  // NCM 会话交付解包后的原流，保留已确认的外层容器。
  if (playback.effectiveProcessing.some(step => typeof step === 'object' && step !== null && 'type' in step && step.type === 'ncmDecrypt')) {
    return ['NCM', output ?? codecName(source?.codec)].filter(Boolean).join(' → ');
  }
  return output ?? input ?? tr('编码未知');
}

/** 展示源封装、内层编码与服务端交付编码；采样率和码率使用实际交付数据。 */
export function playbackFormat(track: SourceTrack, playback: Playback | null): string {
  const chain = formatChain(track, playback);
  if (!playback) {
    const versions = track.downloadVersions ?? [];
    const measured = versions.filter(v => v.formatMeasured);
    if (!measured.length) return chain;
    const formats = [...new Set(measured.map(v => formatPair(v.container, v.codec)).filter(Boolean))].join(' / ');
    if (versions.length === 1) return [tr('已下载'), formats, versionParameters(measured[0])].filter(Boolean).join(' · ');
    return [tr('已下载 · {0} 个版本', { 0: versions.length }), formats].filter(Boolean).join(' · ');
  }
  const output = playback.outputProfile;
  const channels = channelCount(output);
  const channelLabel = channels === undefined ? tr('声道未知') : tr('{0} 声道', { 0: channels });
  return [chain, sampleRateLabel(output.sampleRate), bitrateLabel(output.bitrateBps), channelLabel,
    output.bitDepth && `${output.bitDepth} bit`].filter(Boolean).join(' · ');
}

export function playbackFormatTitle(track: SourceTrack, playback: Playback | null): string {
  if (!playback && track.downloadVersions?.some(v => v.formatMeasured)) return playbackFormat(track, null);
  const source = sessionSource(track, playback);
  const sourceRate = playback && playback.deliveryMode !== 'processed' ? playback.outputProfile.bitrateBps : source?.bitrateBps;
  const details = [playbackFormat(track, playback), tr('来源码率：{0}', { 0: bitrateLabel(sourceRate) })];
  if (playback) details.push(tr('发送码率：{0}', { 0: bitrateLabel(playback.outputProfile.bitrateBps) }));
  return details.join('\n');
}
