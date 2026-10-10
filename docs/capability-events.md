# 能力变更订阅

登录成功或恢复会话后，Web 通过同源 Cookie 建立一个 `GET /api/v1/events` SSE 连接。连接由应用服务持有，不随页面切换或 React StrictMode 重复挂载而新建；退出登录、会话失效和开发热更新清理时关闭连接。

收到 `capabilities.changed` 的 `{ revision, sequence }` 后，重新请求当前页面使用的授权来源列表，包括曲目来源、设置页来源、在线搜索来源和导入歌单来源。能力以 `/provider-instances`、`/online-instances` 的实际响应为准，不使用事件推断权限或插件状态。暂未增加插件管理页面。

Server 在每次建立连接后立即发送当前版本。浏览器自动重连后，即使版本未变也重新读取列表，补偿断线期间漏掉的通知。同一次连接内重复通知会合并；无效通知会忽略。连接报错时另行检查当前会话，401 会清理登录状态，临时网络错误交由 EventSource 自动重试。

自动验证：`npm test` 包含订阅、去重、重连、注销和无效事件检查；`npm run test:e2e -- tests/e2e/capability-events.spec.ts` 使用真实 Server 与开发模式浏览器验证插件停启后的刷新、事件连接中断重连和注销。浏览器验证沿用现有测试服务器配置。
