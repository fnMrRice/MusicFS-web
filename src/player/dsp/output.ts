export type AudioOutputLayout = 'source' | 'mono' | 'stereo' | '5.1' | '7.1';

export interface AudioOutputConfig {
  layout: AudioOutputLayout;
  expandStereo: boolean;
}

export interface AudioOutputStatus {
  supported: boolean;
  maxChannels: number | null;
  sourceChannels: number | null;
  outputChannels: number | null;
  limited: boolean;
}

export function defaultAudioOutput(): AudioOutputConfig { return { layout: 'source', expandStereo: false }; }

export function normalizeAudioOutput(value: unknown): AudioOutputConfig {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const layout = typeof input.layout === 'string' && ['source', 'mono', 'stereo', '5.1', '7.1'].includes(input.layout)
    ? input.layout as AudioOutputLayout : 'source';
  return { layout, expandStereo: input.expandStereo === true };
}

export function outputChannelCount(layout: AudioOutputLayout, sourceChannels: number): number {
  return layout === 'source' ? sourceChannels : ({ mono: 1, stereo: 2, '5.1': 6, '7.1': 8 }[layout]);
}

export function validChannelCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 32 ? value : null;
}

/** 保留设备可接收的原始布局；显式布局过大时退到最接近的常用布局。 */
export function supportedOutputChannels(requested: number, maximum: number): number {
  if (requested <= maximum) return requested;
  return [8, 6, 2, 1].find((channels) => channels <= maximum) ?? 1;
}
