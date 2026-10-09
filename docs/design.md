# MusicFS-web 设计入口

当前阶段：设计草案，尚无可运行实现。

总体架构与共享图示由 [MusicFS](https://github.com/fnMrRice/MusicFS/blob/main/docs/architecture.md) 管理；OpenAPI、事件协议与协议 SDK 由 [MusicFS-server](https://github.com/fnMrRice/MusicFS-server) 管理。

Web 负责可复用 UI、浏览器播放适配器、搜索、聚合歌单、来源选择与设置。发布可供桌面端消费的版本化 UI 包；不复制桌面宿主逻辑。需验证浏览器 codec、代理 Range、会话授权与部分来源不可用的展示。

[歌单与来源选择线框](https://github.com/fnMrRice/MusicFS/blob/main/docs/prototypes/client.salt.puml)

[连接与歌词设置线框](https://github.com/fnMrRice/MusicFS/blob/main/docs/prototypes/settings.salt.puml)

线框以 PlantUML Salt 源码交付；布局不是最终视觉设计。协议 SDK 与 UI 包通过发布版本关联，跨仓库变更需声明兼容范围。
