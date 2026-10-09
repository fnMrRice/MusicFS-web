# NCM 最小 Web 联调

状态：2026-10-09，Windows / Edge 154.0.4258.62 真实无头浏览器完成3项联调，最终一次全通过（19.3秒）。仅验证本文的合成 MP3/FLAC 封装与错误样本。

运行入口：[Server 本地运行](../../server/docs/running.md) → [NCM 插件配置](../../server/docs/ncm.md)。配置 `ncmWorkerPath` 并重启、重新扫描后，页面直接选曲；FLAC 转码需同时配齐音频 Worker、FFmpeg/ffprobe。逐项操作及预期见 [手动验收](manual-validation.md)。

## 兼容处理

现有播放 DTO 接受 `effectiveProcessing` 的扩展项，`proxy`、`processed`、`byteRange` 与 `timeRestart` 均沿用现有路径。新增 `type=ncmDecrypt, gainDb=0, version=1, execution=server` 只代表服务端解密，不当作增益 DSP。

页面没有新增操作入口：纯解密输出在原有说明处显示“服务端解密输出”；解密后转码显示“服务端解密并转码输出”。只有用户勾选既有“-6 dB”选项并重新选择曲目时才请求该增益效果。

## 可重复材料与实际结果

样本由 [独立 Node 生成器](../tests/fixtures/ncm.ts) 将 Server 项目的 CC0 合成 MP3/FLAC 封装而来；文件布局参考与生成方法见 [样本说明](../tests/fixtures/README.md)。没有私人音乐、下载平台账号或第三方原曲；原始输入保持不变。

| 场景 | 判定要求 | 当前结果 |
| --- | --- | --- |
| NCM 内嵌 MP3 | 解密后 proxy/byteRange；部分 Range 字节与原始 MP3 完全一致，完整输出 SHA-512 一致；实际浏览器非零 PCM、定位/停止 | 通过。HEAD长度33432；206返回bytes 257-768/33432；4.5秒定位后PCM RMS 0.045378；effectiveProcessing仅含ncmDecrypt |
| NCM 内嵌 FLAC | 解密后经 MP3 处理链；timeRestart 返回新 attempt/URL；4秒定位的实际解码主峰对应660Hz标记 | 通过。positionOriginMs=4000；原生时间轴从新片段开始；PCM RMS 0.084159，主峰656.25Hz（FFT分辨率23.4375Hz） |
| 损坏 NCM | 明确结构化错误，无磁盘路径泄漏；可选择时页面显示失败/重播；随后原 WAV 仍可实际播放 | 通过。415 UNSUPPORTED；页面显示从头播放并卸载audio；切至普通WAV后RMS 0.044437，停止卸载audio |

机器可读证据见 [Edge NCM 验证记录](validation/ncm-edge-2026-10-09.json)，包括原始/封装摘要、实际播放描述、新旧attempt/URL与解码数据。界面截图：[纯解密MP3](validation/ncm-mp3-player.png)、[FLAC解密转码并定位](validation/ncm-flac-player.png)。截图中的“-6 dB”选项均未勾选；FLAC处理链报告gain=0，未请求衰减。

验证命令：`npm run build`、`npm run typecheck`、`npm test`、`npm run test:e2e -- ncm.spec.ts --max-failures=1`。构建和类型检查通过，既有23项单测通过；NCM联调最终3项通过。首次联调前两项通过，第三项误将普通WAV传输模式预期写为direct，修正为当前Server的proxy后定向通过，再执行上述最终一轮保留完整证据。

NCM 专用启动器构建自己的临时 Server/Local Files/音频/NCM 工作进程，以 `ncmWorkerPath` 显式启用插件，使用FFmpeg 6.1.1，其他既有 E2E 维持原样。本机端口、随机测试凭据和清理规则与原有测试一致；临时运行目录已清理，证据不包含令牌/Cookie。独立Node封装还由Go核心逐字节验证得到原始MP3 33432字节、FLAC 87122字节。

限制：非零PCM与频率是实际解码证据，尚未人工通过扬声器试听。测试仅证明其覆盖的合成格式与浏览器；真实NCM文件变体、其他浏览器不能由该结果推断。未在这一轮重复整套原有E2E；其历史结果见 [媒体兼容性](compatibility.md)。
