# 媒体兼容性与真实验收

日期：2026-10-09。单位测试中的媒体端口和事件是 Mock；不作为解码、流式首音或声音定位证据。

| 环境 | 原流 | 处理输出 | 定位 | 听音 |
| --- | --- | --- | --- | --- |
| Windows / Edge 154.0.4258.62（真实无头浏览器） | WAV/PCM 通过 | AIFF→MP3/-6 dB 通过 | byteRange 与 timeRestart 通过 | 待人工确认 |
| Firefox / Safari | 未测 | 未测 | 未测 | 未测 |

真实 E2E 要求实际 Server、临时音乐目录与生成样本；不拦截 API 为假列表。记录浏览器版本、输入失败/输出成功、MIME/容器/编码、attemptId/streamUrl 变化及首音前输出未生成完的时序。只看到 currentTime 增长仍不等于人工听音完成。

## 2026-10-09 实际结果

执行 `npm run build`、`npm test`、`npm run test:e2e -- --max-failures=1`；23 项单元测试与 6 项真实 E2E 全通过（最后完整 E2E 耗时 40.2 秒）。后端为本机新鲜构建的 Go Server、Local Files 插件与音频工作进程，FFmpeg 6.1.1；每轮使用空数据目录、107 个 CC0 合成/重复样本与随机临时登录令牌。

| 验收 | 结果与证据 |
| --- | --- |
| 鉴权/列表 | Cookie HttpOnly、SameSite=Strict、Path=/api/v1；无CSRF扫描403；真实扫描、100条首屏/加载更多、中文文件名、刷新恢复及退出401通过 |
| 原流 | WAV、pcm_s16le、audio/wav、direct、byteRange；浏览器实际206与Content-Range，非法范围416；暂停/继续、3秒定位、快速切歌、停止通过；解码RMS 0.044378 |
| 原输入失败 | 独立加载原始 processing.aiff，Edge实际返回MediaError 4，非仅canPlayType判断 |
| 处理输出 | AIFF→MP3、audio/mpeg、processed、timeRestart，实际执行Server gain=-6 dB；浏览器解码非零PCM |
| 曲目定位 | 连续请求2000/4000ms生成新attempt/representation/URL；最终origin=4000ms，原生currentTime保持片段时间；解码主峰656.25Hz（样本标记660Hz，FFT分辨率23.4375Hz），RMS 0.042179 |
| 流式交付 | 600秒输入：点击后468ms收到首个媒体响应，1374ms时已测得非零PCM（RMS 0.021155）；该HTTP响应仍未结束。随后停止卸载媒体并取消任务 |
| 来源离线 | 将临时测试目录改名，扫描失败后保留已发布列表；恢复目录后仍可播放，退出卸载活动audio |
| 开发代理 | Vite `127.0.0.1:5173` 保留真实Origin，代理到测试Server；登录/原生播放Range206/退出均通过 |

机器可读的最后验证摘录见 [Edge 验证证据](validation/edge-2026-10-09.json)。测试原始报告与截图位于忽略的 `test-results/`；完整测试可以重新生成。

限制：非零PCM和频率证明实际解码及定位内容，尚未由人通过扬声器试听；HTTP流未结束时已解码证明渐进交付，但不声明测量了物理声卡首音时间。Firefox、Safari、Linux浏览器、独立生产反代与真实NAS设备未测。P5—P7 跨源续播、在线平台不在本轮范围。
