# Web 测试夹具

| 文件 | 用途 |
| --- | --- |
| [control-mock.ts](control-mock.ts)、[control-probe.ts](control-probe.ts) | 模拟 HTTP 与 WebSocket 控制消息，或观察浏览器与服务端的控制通信。 |
| [music-catalog.ts](music-catalog.ts)、[dto.ts](dto.ts) | 构造曲目、分页结果和播放会话，用于测试界面与状态变化。 |
| [audio.ts](audio.ts)、[audio-probe.ts](audio-probe.ts) | 生成 PCM WAV 正弦波，测量浏览器输出的信号强度与峰值频率。 |
| [ncm.ts](ncm.ts) | 将 CC0 的 MP3 和 FLAC 样本独立封装为 NCM，并生成损坏样本。 |

## 联调音频

基础样本位于 Server 的 `tests/testdata/audio/`，包括分段频率标记、静音前缀、中文文件名、零字节和损坏文件。生成参数、许可和摘要见[样本清单](https://github.com/fnMrRice/MusicFS-server/blob/main/tests/testdata/audio/manifest.json)。

NCM 生成器使用 `vbr-untagged.mp3` 和 `lossless.flac`，在测试临时目录记录原始文件与封装文件的 SHA-512。封面帧保留 32 字节，声明的图片数据为 4 字节，用于检验音频起点。MP3 的前两秒是静音，FLAC 在第 4 秒有 660 Hz 标记。[NCM 播放测试](../e2e/ncm.spec.ts)

独立封装实现参考了两个 MIT 许可项目公开的文件布局。[ncmdump-go](https://git.taurusxin.com/taurusxin/ncmdump-go/src/branch/main/ncmcrypt/ncmcrypt.go) · [ncmdump.rs](https://github.com/iqiziqi/ncmdump.rs/blob/master/crates/ncmdump/src/ncmdump.rs)
