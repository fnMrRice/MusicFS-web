export type LocalDSPKind = 'gain' | 'equalizer' | 'compressor' | 'reverb';

export interface LocalDSPNode {
  id: string;
  kind: LocalDSPKind;
  enabled: boolean;
  params: Record<string, number>;
}

export interface LocalDSPConfig {
  enabled: boolean;
  chain: LocalDSPNode[];
}

export interface LocalDSPParameter {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
}

export interface LocalDSPDefinition {
  kind: LocalDSPKind;
  name: string;
  description: string;
  params: LocalDSPParameter[];
}

export const MAX_LOCAL_DSP_NODES = 16;

export const localDSPCatalog: LocalDSPDefinition[] = [
  { kind: 'gain', name: '增益', description: '调整信号电平；提升多个效果的增益可能导致失真。', params: [
    { key: 'gain', label: '增益', min: -24, max: 12, step: 0.1, defaultValue: 0, unit: 'dB' },
  ] },
  { kind: 'equalizer', name: '参数均衡器', description: '调整一个频段，可添加多个均衡器组合调音。', params: [
    { key: 'frequency', label: '中心频率', min: 20, max: 20000, step: 1, defaultValue: 1000, unit: 'Hz' },
    { key: 'q', label: 'Q 值', min: 0.1, max: 18, step: 0.1, defaultValue: 1 },
    { key: 'gain', label: '增益', min: -24, max: 24, step: 0.1, defaultValue: 0, unit: 'dB' },
  ] },
  { kind: 'compressor', name: '动态压缩', description: '压低超过阈值的信号，控制音量动态。', params: [
    { key: 'threshold', label: '阈值', min: -100, max: 0, step: 1, defaultValue: -24, unit: 'dB' },
    { key: 'knee', label: '拐点宽度', min: 0, max: 40, step: 1, defaultValue: 30, unit: 'dB' },
    { key: 'ratio', label: '压缩比', min: 1, max: 20, step: 0.1, defaultValue: 4 },
    { key: 'attack', label: '启动时间', min: 0, max: 1, step: 0.001, defaultValue: 0.003, unit: 's' },
    { key: 'release', label: '释放时间', min: 0, max: 1, step: 0.001, defaultValue: 0.25, unit: 's' },
  ] },
  { kind: 'reverb', name: '混响', description: '通过延迟和滤波模拟空间反射，可实时调整尾音。', params: [
    { key: 'mix', label: '混响比例', min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
    { key: 'decay', label: '衰减时间', min: 0.1, max: 6, step: 0.1, defaultValue: 1.5, unit: 's' },
    { key: 'tone', label: '高频截止', min: 500, max: 20000, step: 100, defaultValue: 6000, unit: 'Hz' },
  ] },
];

let sequence = 0;
function newId(): string {
  // 局域网 HTTP 中 randomUUID 可能不可用，标识只需要在当前配置内唯一。
  return `local-dsp-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
}

export function defaultLocalDSP(): LocalDSPConfig {
  return { enabled: true, chain: [] };
}

export function createLocalDSPNode(kind: LocalDSPKind): LocalDSPNode {
  const definition = localDSPCatalog.find((entry) => entry.kind === kind);
  if (!definition) throw new Error('Unknown local DSP effect');
  return {
    id: newId(), kind, enabled: true,
    params: Object.fromEntries(definition.params.map((param) => [param.key, param.defaultValue])),
  };
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function normalizeLocalDSP(value: unknown): LocalDSPConfig {
  const source = object(value);
  const seen = new Set<string>();
  const chain: LocalDSPNode[] = [];
  for (const candidate of Array.isArray(source.chain) ? source.chain : []) {
    const raw = object(candidate);
    const definition = localDSPCatalog.find((entry) => entry.kind === raw.kind);
    if (!definition) continue;
    let id = typeof raw.id === 'string' && raw.id.trim() && raw.id.length <= 128 ? raw.id : newId();
    while (seen.has(id)) id = newId();
    seen.add(id);
    const params = object(raw.params);
    chain.push({
      id, kind: definition.kind, enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
      params: Object.fromEntries(definition.params.map((param) => {
        const supplied = params[param.key];
        const numeric = typeof supplied === 'number' && Number.isFinite(supplied) ? supplied : param.defaultValue;
        return [param.key, Math.max(param.min, Math.min(param.max, numeric))];
      })),
    });
    if (chain.length === MAX_LOCAL_DSP_NODES) break;
  }
  return { enabled: typeof source.enabled === 'boolean' ? source.enabled : true, chain };
}
