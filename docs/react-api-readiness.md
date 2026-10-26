# React UI 接口接入清单

核对日期：2026-10-10。以当前 Server `docs/contracts/openapi.yaml` 与 `http.schema.json` 为依据。本轮 Server 已补齐搜索、完整查询、个人资料与记录、来源引用批量展示等接口；Web 本轮新增接入能力变更订阅，其他新增接口的页面适配仍待实施。完成对照见 [Server 交接](../../server/docs/contracts/web-integration.md)。

| 页面 | 接入范围 | 边界 |
| --- | --- | --- |
| 登录、账号、设置 | readiness、session、me/profile、provider-instances | 同源 Cookie、Origin、CSRF；个人信息卡已接入昵称读取、修改及清空；使用默认头像 |
| 曲目列表 | source-tracks 实例过滤、固定修订游标 | 连续滚动；全库关键词、格式、收藏、观测可用性和排序已有接口，页面待适配；不支持静态“仅可播放”判断 |
| 在线搜索 | online-instances 与逐实例 search | 当前 UI 仅接曲目资料；Server 已有四类搜索，其余页签及详情待适配；无在线播放承诺 |
| 推荐 | recommendations 逐来源卡片和 stale/error | 原始来源顺序，失败不遮挡其他来源；点击只预览 |
| 推荐歌单详情 | 既有在线 playlist observation | 显示真实歌单摘要，显式导入；新增曲目展示分页待适配，不把 external ID 伪装成曲名 |
| 个人歌单 | 列表、创建、读取、带 expectedRevision 编辑、重建、固定快照 | 按顺序聚合本地／远程／个人歌单；旧修订拒绝后提示刷新；不写回平台 |
| 远程歌单 | 显式导入、读取、sync-jobs、任务轮询 | POST 返回 jobId 收据，必须读任务终态；保留 stale、错误与上次成功时间 |
| 专辑 | source-albums 列表与详情 | 来源身份；成员按当前库读取，不按同名合并 |
| 播放器 | 原有 session、seek、recover、关闭和同源 stream | 独立全局服务、曲目时间映射、一次一个活动 audio、暂停意图和音量重应用 |
| 歌词／封面 | media-selection 和 media 内容 | 仅当前来源有效绑定；文本展示，不启用逐句定位；列表使用占位封面 |
| 收藏、最近播放 | 保留页面 | Server 已有账号隔离读写、清理与分页接口；页面和实际播放上报待适配 |
| 能力变更 | events 的 capabilities.changed SSE | 登录后单连接，初次及重连后刷新当前页面的授权来源列表；注销关闭；[接入说明](capability-events.md) |

## Server 已交付、Web 待接入

- `/library/search`、`/library/facets`、`/source-artists/{id}`：本地关键词、分类、组合过滤、排序及歌手详情。
- `/library/queries`、`/library/queries/{id}`：固定完整查询结果的创建、分页、恢复和取消；“播放全部”不能继续用当前已加载页代替。
- 在线逐实例 `search?kind=...`：曲目、专辑、歌手、歌单；专辑／歌手详情及相关曲目／专辑分页。
- `/playlists?q=...`、在线歌单 `tracks` 分页、`/source-refs/lookup` 和在线曲目批量读取：本人歌单搜索与引用展示。
- `/me/favorites`、`/me/recently-played`：账号收藏和最近播放。最近播放需要在真实播放开始后上报，遵守会话去重和保存期限；昵称已通过 `/me/profile` 接入，头像上传仍未支持。

目前 UI 的歌单本地曲目展示仍遍历固定修订曲库关联，批量读取接口已提供，尚待替换。`availableOnly` 仅表示扫描观测可用，不能承诺音频解码或播放授权；`playableOnly` 尚不支持。远程资料引用不构成音频播放许可，在线现网结果仍受配置、权限和来源状态影响，界面 Mock 测试不能代替平台验收。完整接口字段和保留边界见 [Server 完成对照](../../server/docs/contracts/web-integration.md)。

## 安全与一致性

- 身份只使用服务端真实 user ID；主题／分组按实例及用户隔离保存，音量使用同站点共用固定键。队列以 `localStorage` 固定键 `musicfs:playback-queue:v1` 仅保存一份白名单元数据及导航状态，刷新恢复顺序、重复项、选中索引、模式、随机历史和下一首优先项，不自动播放或恢复旧流地址。
- 查询取消、单在途追加、游标去重、不前进保护、修订过期提示刷新；不将当前部分结果当成全库筛选／排序。
- 勾选仅作用于已返回的稳定曲目 ID，追加项不自动选中；来源切换或刷新清空选择。
- 退出／401 停止播放器并关闭事件连接，清空队列及其本地缓存、曲库缓存和当前用户态；更换 API 地址也清空队列缓存，不按账号或地址保留多份。所有写请求使用 CSRF，协议要求的操作带幂等键或预期修订。
- Web 不提供迷你模式、窗口控制、桌面快捷键、操作系统托盘或插件管理。
