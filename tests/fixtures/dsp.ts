import type { DSPPlugin, DSPSettingsPage } from "../../src/api/dsp";

const port = { sampleFormat: "f32le", sampleRate: 48000, layouts: ["mono", "stereo", "5.1", "7.1"] };
const output = { canContinueDSP: true, sameAsInput: true, layouts: port.layouts };
export const dspCatalog: DSPPlugin[] = [
  { name: "gain", aliases: ["musicfs.dsp.gain"], version: 1, displayName: "增益", description: "调整全部声道的音量。",
    input: port, output, parameters: [{ key: "gainDB", label: "增益（dB）", min: -96, max: 12, step: 0.1, defaultValue: 0 }] },
  { name: "equalizer", version: 1, displayName: "均衡器", description: "调整一个频段；可重复添加形成多段均衡。",
    input: port, output, parameters: [{ key: "frequencyHz", label: "中心频率（Hz）", min: 20, max: 20000, step: 1, defaultValue: 1000 }] },
  { name: "channelmix", version: 1, displayName: "声道转换", description: "转换中间声道布局；扩展声道不合成环绕声。",
    input: port, output: { ...output, sameAsInput: false }, parameters: [{ key: "outputChannels", label: "输出声道", min: 1, max: 8, step: 1, defaultValue: 2,
      options: [{ value: 1, label: "单声道" }, { value: 2, label: "立体声" }, { value: 6, label: "5.1" }, { value: 8, label: "7.1" }] }] },
  { name: "terminal", version: 1, displayName: "终端测试效果", description: "测试终端输出。", input: port,
    output: { ...output, canContinueDSP: false }, parameters: [] },
];
export function dspPage(scope: "personal" | "global" = "personal"): DSPSettingsPage {
  const settings = { chain: [], outputLayout: "stereo", bufferFrames: 4096 };
  return { scope, usesGlobal: scope === "personal", revision: 3, schemaRevision: "dsp-settings-v1", settings,
    defaults: structuredClone(settings), catalog: dspCatalog, maxNodes: 15, available: true, outputLayouts: ["stereo", "5.1", "7.1"] };
}
