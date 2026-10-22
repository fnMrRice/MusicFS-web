import type { Page } from '@playwright/test';

// 在浏览器测试中测量最终输出，避免为同一媒体元素重复创建音源节点。
export async function installAudioProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as { musicfsAudioProbe?: { analyser: AnalyserNode; context: AudioContext }; musicfsProbeInstalled?: boolean };
    if (scope.musicfsProbeInstalled || typeof AudioNode === 'undefined') return;
    scope.musicfsProbeInstalled = true;
    const connect = AudioNode.prototype.connect as (this: AudioNode, target: AudioNode, output?: number, input?: number) => AudioNode;
    const connectParam = AudioNode.prototype.connect as (this: AudioNode, target: AudioParam, output?: number) => void;
    const analysers = new WeakMap<BaseAudioContext, AnalyserNode>();
    AudioNode.prototype.connect = function(this: AudioNode, destination: AudioNode | AudioParam, output?: number, input?: number) {
      if (destination instanceof AudioDestinationNode) {
        let analyser = analysers.get(this.context);
        if (!analyser) {
          analyser = this.context.createAnalyser();
          analyser.fftSize = 2048;
          analysers.set(this.context, analyser);
          connect.call(analyser, destination, 0, 0);
        }
        scope.musicfsAudioProbe = { analyser, context: this.context as AudioContext };
        return connect.call(this, analyser, output ?? 0, input ?? 0);
      }
      if (destination instanceof AudioParam) {
        connectParam.call(this, destination, output);
        return;
      }
      return connect.call(this, destination, output ?? 0, input ?? 0);
    } as typeof AudioNode.prototype.connect;
  });
}

export async function outputSignal(page: Page): Promise<{ rms: number; peakHz: number }> {
  return page.evaluate(async () => {
    const probe = (window as unknown as { musicfsAudioProbe?: { analyser: AnalyserNode; context: AudioContext } }).musicfsAudioProbe;
    if (!probe) throw new Error('No browser audio output was attached');
    const { analyser, context } = probe;
    let maximum = 0;
    let peakHz = 0;
    const buffer = new Float32Array(analyser.fftSize);
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    for (let i = 0; i < 20; i++) {
      analyser.getFloatTimeDomainData(buffer);
      maximum = Math.max(maximum, Math.sqrt(buffer.reduce((sum, sample) => sum + sample * sample, 0) / buffer.length));
      analyser.getFloatFrequencyData(spectrum);
      const index = spectrum.reduce((best, value, index) => value > spectrum[best] ? index : best, 0);
      if (spectrum[index] > -80) peakHz = index * context.sampleRate / analyser.fftSize;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return { rms: maximum, peakHz };
  });
}
