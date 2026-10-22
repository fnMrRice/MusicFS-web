type Speaker = 'M' | 'L' | 'R' | 'C' | 'LFE' | 'BL' | 'BR' | 'SL' | 'SR';

// 与服务端 PCM/WAV 声道顺序一致；八声道必须显式映射，不能依赖浏览器 speakers 推断。
const layouts: Record<number, Speaker[]> = {
  1: ['M'], 2: ['L', 'R'], 6: ['L', 'R', 'C', 'LFE', 'BL', 'BR'],
  8: ['L', 'R', 'C', 'LFE', 'BL', 'BR', 'SL', 'SR'],
};

export interface OutputMatrixRow {
  weights: number[];
  filter?: 'lowpass' | 'highpass';
  delay?: number;
}

/** 各输出行的绝对权重之和不超过一，避免相关声道求和溢出。LFE 不混入小型扬声器。 */
export function outputMatrix(sourceChannels: number, outputChannels: number, expandStereo: boolean): OutputMatrixRow[] {
  // 仅知道声道数时不能区分 6.1/7.0 等布局；未知布局保持离散顺序，不猜扬声器角色。
  if (!layouts[sourceChannels] || !layouts[outputChannels]) {
    return Array.from({ length: outputChannels }, (_, output) => ({
      weights: Array.from({ length: sourceChannels }, (_, input) => input === output ? 1 : 0),
    }));
  }
  const source = layouts[sourceChannels] ?? layouts[2]!;
  const target = layouts[outputChannels] ?? layouts[2]!;
  return target.map((speaker, outputIndex) => {
    const weights = source.map(() => 0);
    const add = (name: Speaker, weight: number) => {
      const index = source.indexOf(name);
      if (index >= 0) weights[index] = (weights[index] ?? 0) + weight;
    };
    if (sourceChannels === outputChannels) weights[outputIndex] = 1;
    else if (sourceChannels === 2 && outputChannels >= 6 && expandStereo) {
      if (speaker === 'L') add('L', 1);
      else if (speaker === 'R') add('R', 1);
      else if (speaker === 'C') { add('L', .5); add('R', .5); }
      else if (speaker === 'LFE') { add('L', .25); add('R', .25); }
      else {
        const left = speaker === 'BL' || speaker === 'SL';
        const level = outputChannels === 8 && (speaker === 'BL' || speaker === 'BR') ? .35 : .5;
        add('L', left ? level : -level); add('R', left ? -level : level);
      }
      if (speaker === 'LFE') return { weights, filter: 'lowpass' };
      if (speaker === 'BL' || speaker === 'BR' || speaker === 'SL' || speaker === 'SR') {
        const rear = outputChannels === 8 && (speaker === 'BL' || speaker === 'BR');
        return { weights, filter: 'highpass', delay: (rear ? .027 : .015) + (speaker.endsWith('R') ? .006 : 0) };
      }
    } else if (speaker === 'M') {
      for (const name of source) if (name !== 'LFE') add(name, name === 'C' || name === 'M' ? 1 : Math.SQRT1_2);
    } else if (sourceChannels === 1) {
      // 单声道优先放中置；仅双声道布局时复制到左右。
      if (speaker === 'C' || (!target.includes('C') && (speaker === 'L' || speaker === 'R'))) add('M', 1);
    } else {
      add(speaker, 1);
      if ((speaker === 'L' || speaker === 'R') && !target.includes('C')) add('C', Math.SQRT1_2);
      for (const side of ['L', 'R'] as const) {
        const back: Speaker = side === 'L' ? 'BL' : 'BR';
        const surround: Speaker = side === 'L' ? 'SL' : 'SR';
        if (speaker === side && !target.includes(back) && !target.includes(surround)) {
          add(back, Math.SQRT1_2); add(surround, Math.SQRT1_2);
        } else if (speaker === back && !target.includes(surround) && source.includes(surround)) {
          // 7.1 后方和侧方合并，同权重后归一化。
          if (source.includes(back)) weights[source.indexOf(back)] = Math.SQRT1_2;
          add(surround, Math.SQRT1_2);
        }
      }
    }
    const total = weights.reduce((sum, value) => sum + Math.abs(value), 0);
    return { weights: total > 1 ? weights.map((value) => value / total) : weights };
  });
}
