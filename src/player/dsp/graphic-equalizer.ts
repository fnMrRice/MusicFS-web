import type { LocalDSPParameter } from './model';

export const graphicEqualizerBands = [
  { key: 'band31', frequency: 31, label: '31' },
  { key: 'band63', frequency: 63, label: '63' },
  { key: 'band125', frequency: 125, label: '125' },
  { key: 'band250', frequency: 250, label: '250' },
  { key: 'band500', frequency: 500, label: '500' },
  { key: 'band1000', frequency: 1000, label: '1k' },
  { key: 'band2000', frequency: 2000, label: '2k' },
  { key: 'band4000', frequency: 4000, label: '4k' },
  { key: 'band8000', frequency: 8000, label: '8k' },
  { key: 'band16000', frequency: 16000, label: '16k' },
] as const;

export const graphicEqualizerParameters: LocalDSPParameter[] = [
  ...graphicEqualizerBands.map((band) => ({
    key: band.key, label: `${band.frequency} Hz`, min: -12, max: 12, step: 0.5, defaultValue: 0, unit: 'dB',
  })),
  { key: 'bassGain', label: '低音增强', min: 0, max: 12, step: 0.5, defaultValue: 0, unit: 'dB' },
  { key: 'trebleGain', label: '高音增强', min: 0, max: 12, step: 0.5, defaultValue: 0, unit: 'dB' },
];

function preset(id: string, name: string, gains: number[]) {
  return {
    id, name,
    params: {
      ...Object.fromEntries(graphicEqualizerBands.map((band, index) => [band.key, gains[index]])),
      bassGain: 0, trebleGain: 0,
    } as Record<string, number>,
  };
}

// 预设是可继续调整的起点；选择预设同时恢复低音、高音增强，避免重复叠加。
export const graphicEqualizerPresets = [
  preset('flat', '平直', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  preset('pop', '流行', [-1, 1, 2, 2, 0, -1, 1, 3, 3, 1]),
  preset('rock', '摇滚', [5, 3, 1, -1, -2, 0, 2, 3, 4, 4]),
  preset('vocal', '人声', [-3, -2, -1, 0, 2, 4, 4, 2, 0, -2]),
];
