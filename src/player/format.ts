import type { OutputProfile, Playback, SourceTrack } from '../api/types';
import { tr } from '../i18n';

function codecName(codec: string | null | undefined): string {
  const value = codec?.trim();
  if (!value) return tr('编码未知');
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

function bitrateLabel(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? `${Math.round(value / 100) / 10} kbps`
    : tr('码率未知');
}

function formatChain(track: SourceTrack, playback: Playback | null): string {
  const stages: string[] = [];
  const container = track.container?.trim().toUpperCase();
  if (container) stages.push(container);
  const source = codecName(track.codec);
  if (source !== stages.at(-1)) stages.push(source);
  if (playback) {
    const output = codecName(playback.outputProfile.codec);
    // 原流省略重复编码；转码即使保持同一编码，也保留输入和输出两个阶段。
    if (playback.deliveryMode === 'processed' || output !== stages.at(-1)) stages.push(output);
  }
  return stages.join(' → ');
}

/** 展示源封装、内层编码与服务端交付编码；码率只使用对应阶段的数据。 */
export function playbackFormat(track: SourceTrack, playback: Playback | null): string {
  const chain = formatChain(track, playback);
  if (!playback) return chain;
  const output = playback.outputProfile;
  const channels = channelCount(output);
  const channelLabel = channels === undefined ? tr('声道未知') : tr('{0} 声道', { 0: channels });
  return `${chain} · ${bitrateLabel(output.bitrateBps)} · ${channelLabel}`;
}

export function playbackFormatTitle(track: SourceTrack, playback: Playback | null): string {
  const details = [playbackFormat(track, playback), tr('来源码率：{0}', { 0: bitrateLabel(track.bitrateBps) })];
  if (playback) details.push(tr('发送码率：{0}', { 0: bitrateLabel(playback.outputProfile.bitrateBps) }));
  return details.join('\n');
}
