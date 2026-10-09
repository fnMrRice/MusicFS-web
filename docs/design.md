# MusicFS-web 设计入口

当前阶段：设计草案，尚无可运行实现。

Server 与客户端共同约定由 [MusicFS 跨端架构](../../docs/architecture.md) 管理；[Server 内部设计](../../server/docs/architecture.md)与[音频处理](../../server/docs/audio-processing.md)由 Server 仓库维护。本文件负责 Web 内部职责，OpenAPI、事件协议与协议 SDK 由 Server 发布。

Web 负责浏览器 UI、播放适配器、搜索、聚合歌单、来源选择与设置，并展示 Music Provider 提供的歌单推荐。与桌面端复用组件或资源的方式待验证后确定；不复制桌面宿主逻辑。需验证浏览器 codec、代理 Range、会话授权与部分来源不可用的展示。

浏览器播放按容器、编码和传输方式与 Server 协商能力。Server 计划通过插件化的解复用、解码、PCM DSP、编码及封装链路提供浏览器可播放的输出；具体格式与传输组合仍需验证。转码流的 seek 由 Server 按时间定位并生成相应输出，不能套用原始音频的字节偏移。可复用 UI 需表达处理效果的执行端，避免 Server 与桌面 Client 重复执行同一 DSP 效果。

跨来源切换遵循跨端架构中的恢复决定：只有同一 Recording、另有适用的时间轴兼容证据且输出支持 seek 时才自动恢复进度；条件不满足或定位失败时提示从头播放，音频指纹匹配不等于时间轴兼容。Web 播放适配器维护当前 attemptId 和播放代次，忽略旧请求结果；资源版本改变时清理旧缓冲并加载新地址，不沿用旧字节偏移。timeRestart 使用 Server 返回的 positionOriginMs 映射曲目时间，向 seek/recover 接口提交的 positionMs 均为曲目时间（毫秒）。若桌面端复用设置组件，音频插件及淡出淡入设置通过宿主适配器呈现；浏览器端能力以实际协商结果为准。

[桌面歌单与来源选择线框参考](../../client/docs/prototypes/client.salt.puml)

[桌面连接与歌词设置线框参考](../../client/docs/prototypes/settings.salt.puml)

线框以 PlantUML Salt 源码交付；布局不是最终视觉设计。协议 SDK 按发布版本关联；若桌面端复用 Web 组件或资源，也需记录对应版本。跨仓库变更需声明兼容范围。
