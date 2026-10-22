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

/** 左侧保留源文件格式，右侧展示本次服务端交付格式，不推断浏览器或音响设备输出。 */
export function playbackFormat(track: SourceTrack, playback: Playback | null): string {
  const source = codecName(track.codec);
  if (!playback) return source;
  const output = playback.outputProfile;
  const channels = channelCount(output);
  const channelLabel = channels === undefined ? tr('声道未知') : tr('{0} 声道', { 0: channels });
  return `${source} → ${codecName(output.codec)} · ${channelLabel}`;
}
