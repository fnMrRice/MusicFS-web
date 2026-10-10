# MusicFS-web 设计入口

当前阶段（2026-10-10）：已由 React 接管界面，提供共享外壳、曲目表、搜索／推荐、歌单、专辑和设置；已有接口接入、未支持能力及验证范围见 [React 交付记录](react-validation.md)。历史最小页面记录保留于 [实施记录](progress.md)。

按 [TypeScript + React 开发方案](react-development.md)和[共享 UI 设计](../../docs/ui-design.md)实现 Web。顶部只保留设置与换肤，不含桌面窗口控制。接口接入范围见[依赖清单](react-api-readiness.md)，Server 侧需求见[缺口交接](../../server/docs/web-ui-api-gaps.md)。

旧版原生 DOM 页面与原生音频控件已移除；React 自定义播放栏沿用原流、处理输出和 NCM 控制核心。目录设置、扫描、插件、平台账号和刮削编辑仍通过 Server 配置／管理工具完成；下文长期职责不代表全部能力已经交付。

Server 与客户端共同约定由 [MusicFS 跨端架构](../../docs/architecture.md) 管理；[Server 内部设计](../../server/docs/architecture.md)与[音频处理](../../server/docs/audio-processing.md)由 Server 仓库维护。本文件负责 Web 内部职责，OpenAPI、事件协议与协议 SDK 由 Server 发布。

Web 负责浏览器 UI、播放适配器、搜索、聚合歌单、来源选择与设置，并展示 Music Provider 提供的歌单推荐。与桌面端复用组件或资源的方式待验证后确定；不复制桌面宿主逻辑。需验证浏览器 codec、代理 Range、会话授权与部分来源不可用的展示。

浏览器播放按容器、编码和传输方式与 Server 协商能力。当前已接通 Server 的 FFmpeg 解码/编码、Go PCM 增益链与独立 NCM 解密插件；纯解密与解密后转码分别显示说明，不把解密等同于 DSP，实际范围见 [NCM 验证记录](ncm-validation.md)。其他格式与传输组合仍需逐项验证。转码流的 seek 由 Server 按时间定位并生成相应输出，不能套用原始音频的字节偏移。可复用 UI 需表达处理效果的执行端，避免 Server 与桌面 Client 重复执行同一 DSP 效果。

跨来源切换遵循跨端架构中的恢复决定：只有同一 Recording、另有适用的时间轴兼容证据且输出支持 seek 时才自动恢复进度；条件不满足或定位失败时提示从头播放，音频指纹匹配不等于时间轴兼容。Web 播放适配器维护当前 attemptId，区分歌曲代次与定位意图：忽略旧歌曲/会话结果，同会话 seek/recover 串行确认 attemptId 后再执行最新意图。资源版本改变时清理旧缓冲并加载新地址，不沿用旧字节偏移。timeRestart 使用 Server 返回的 positionOriginMs 映射曲目时间，向 seek/recover 接口提交的 positionMs 均为曲目时间（毫秒）。若桌面端复用设置组件，音频插件及淡出淡入设置通过宿主适配器呈现；浏览器端能力以实际协商结果为准。

[桌面歌单与来源选择线框参考](../../client/docs/prototypes/client.salt.puml)

[桌面连接与歌词设置线框参考](../../client/docs/prototypes/settings.salt.puml)

线框以 PlantUML Salt 源码交付；布局不是最终视觉设计。协议 SDK 按发布版本关联；若桌面端复用 Web 组件或资源，也需记录对应版本。跨仓库变更需声明兼容范围。
