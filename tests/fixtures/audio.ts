// 有效 PCM 用于验收真实媒体元素播放进度，不依赖浏览器音频方法替身。
export function audioFixture(seconds = 30): Buffer {
  const rate = 16000, frames = rate * seconds, data = Buffer.alloc(44 + frames * 2);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) data.writeInt16LE(Math.round(2000 * Math.sin(2 * Math.PI * 440 * frame / rate)), 44 + frame * 2);
  return data;
}
