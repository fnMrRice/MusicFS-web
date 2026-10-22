import { outputMatrix } from './output-matrix';

/** 离散声道矩阵位于效果之后；路由重建不触及媒体源、效果状态或末端音量包络。 */
export class AudioOutputRouting {
  readonly input: GainNode;
  readonly output: GainNode;
  private nodes: AudioNode[] = [];

  constructor(context: BaseAudioContext, sourceChannels: number, readonly channels: number, expandStereo: boolean) {
    const remember = <T extends AudioNode>(node: T): T => { this.nodes.push(node); return node; };
    this.input = remember(context.createGain());
    this.output = remember(context.createGain());
    this.input.channelCount = sourceChannels;
    this.output.channelCount = channels;
    for (const node of [this.input, this.output]) { node.channelCountMode = 'explicit'; node.channelInterpretation = 'discrete'; }
    try {
      if (sourceChannels === channels) { this.input.connect(this.output); return; }
      const splitter = remember(context.createChannelSplitter(sourceChannels));
      const merger = remember(context.createChannelMerger(channels));
      this.input.connect(splitter);
      outputMatrix(sourceChannels, channels, expandStereo).forEach((row, outputIndex) => {
        const sum = remember(context.createGain());
        sum.channelCount = 1;
        sum.channelCountMode = 'explicit';
        sum.channelInterpretation = 'discrete';
        row.weights.forEach((weight, inputIndex) => {
          if (weight === 0) return;
          const gain = remember(context.createGain());
          gain.gain.value = weight;
          splitter.connect(gain, inputIndex); gain.connect(sum);
        });
        let tail: AudioNode = sum;
        if (row.filter) {
          const filter = remember(context.createBiquadFilter());
          filter.type = row.filter;
          filter.frequency.value = row.filter === 'lowpass' ? 120 : 180;
          // Web Audio 的低通/高通 Q 使用 dB；转换 Butterworth Q，避免截止附近产生共振峰。
          filter.Q.value = 20 * Math.log10(Math.SQRT1_2);
          tail.connect(filter); tail = filter;
        }
        if (row.delay) {
          const delay = remember(context.createDelay(.1));
          delay.delayTime.value = row.delay;
          tail.connect(delay); tail = delay;
        }
        // 没有输入的行保持静音，同时占据固定声道位置。
        tail.connect(merger, 0, outputIndex);
      });
      merger.connect(this.output);
    } catch (error) { this.dispose(); throw error; }
  }

  dispose(): void { for (const node of this.nodes) node.disconnect(); this.nodes = []; }
}
