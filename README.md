# MusicFS-web

MusicFS 的浏览器界面。本期先实现简单文件列表和播放：显示 Server 扫描得到的文件，支持播放、暂停、定位和停止；无需特别设计界面。

已实现 TypeScript + Vite + 原生 DOM 最小页面：登录与刷新恢复、真实来源文件列表、分页与刷新、原流播放、暂停/停止、服务端处理输出与曲目时间定位。完整验证记录见 [实施记录](docs/progress.md) 和 [兼容性记录](docs/compatibility.md)；人工听音须单独确认，不由自动化结果代替。

## 启动与构建

固定环境：Node.js **26.3.1**、npm **11.16.0**。固定依赖为 TypeScript 5.9.3、Vite 8.3.4、Vitest 5.0.3、Playwright 1.64.0；传递依赖由 `package-lock.json` 锁定。

```powershell
npm ci
npm run dev
```

开发页面为 `http://127.0.0.1:5173`，默认代理至 `http://127.0.0.1:8080`。Server 必须显式允许开发页面的 Origin。需要其他 Server 端口时，在启动开发服务前设置 `$env:MUSICFS_DEV_SERVER`；该地址仅用于开发服务器，不写入浏览器制品。

```powershell
npm run typecheck
npm test
npm run build
```

交付目录为 `dist/`，包含 `version.json`。所有运行时 API 地址均为同源相对路径；构建不需要 token。生产可使用静态站点加同源 `/api` 反向代理，也可按 [Server README](../server/README.md) 启动时加 `--web-root` 指向 `dist`。

## 最短播放步骤

1. 按 Server 文档配置音乐目录、FFmpeg/插件、鉴权及允许的 Origin，启动 Server。
2. 在页面输入显式配置的管理员登录令牌。成功后输入会清空，刷新依靠 HttpOnly cookie 恢复；令牌不写浏览器持久存储。
3. 使用 Server 管理 API 对音乐目录执行扫描，返回页面点击“刷新列表”。目录与扫描均由 Server 管理。
4. 点击曲目旁的“播放”，使用原生控件暂停/继续或调整音量；“停止”释放当前会话。
5. 可勾选“服务端处理”后再次选择曲目，请求 -6 dB 效果。处理输出使用“曲目位置（秒）”跳转；原生时间轴只表示当前输出片段。

## 真实浏览器测试

```powershell
npm run build
npm run test:e2e
```

测试需要同级 Server 仓库、Go、已安装的 Microsoft Edge，以及 FFmpeg/ffprobe。使用 `MUSICFS_E2E_FFMPEG`、`MUSICFS_E2E_FFPROBE` 指定可执行文件；当前机器的已验证默认路径见测试启动器。测试构建自己的 Server 与插件，在 `127.0.0.1:18081` 启动全新实例，使用独立 `.e2e-runtime/` 数据目录与每次随机生成的临时凭据，不访问个人音乐库。

样本来自 Server 的 CC0 合成音频；包含中文文件名、损坏/零字节文件、分页副本和 600 秒循环 AIFF。测试读取真实 API 与媒体，没有假列表或模拟媒体事件。浏览器记录播放进度及解码的非零 PCM 信号；人工扬声器听音不在自动化证明范围。临时目录与测试输出均忽略于 Git，不包含长期管理员凭据。

## 当前限制

- 本期停止在 P4 与相应交付工作；资产识别、刮削、在线平台和完整音乐管理界面仍在计划中。
- 只消费 Server 已验证的无变速时间映射；恢复预算耗尽或结果不明时要求显式从头播放。
- Windows Edge 的实测结果不代表 Firefox、Safari 或全部设备支持；见兼容性记录。
- 页面关闭通知只能尽力发送，Server 负责会话超时与进程回收。

长期设计仍包含搜索、音乐库与歌单、来源和推荐展示、刮削结果交互；这些完整管理界面不纳入本期最小页面。与桌面端的组件复用方式尚待确定。

## 设计文档

- [分阶段实现计划](docs/implementation.md)：P0—P8 的文件组织、逐步任务、最小页面、鉴权、播放状态和真实媒体验收。
- [实施记录](docs/progress.md)：每步提交标识、验证结果与残留限制。
- [兼容性记录](docs/compatibility.md)：实际浏览器与媒体链路证据。
- [Web 设计](docs/design.md)：浏览器职责、能力探测、播放与状态适配。
- [Server 实现计划](../server/docs/implementation.md)：Go Server、插件与对应联调阶段。
- [跨端架构](../docs/architecture.md)：数据语义、API、播放协商、定位和恢复。
- [Server 音频处理](../server/docs/audio-processing.md)：服务端输出能力与约束。
- [工作约定](AGENTS.md)：仓库工作约定。

本仓库独立管理，浏览器内部设计放在 `docs/`。跨仓库相对链接以本仓库检出到 MusicFS 根目录的 `web/` 为前提；单独克隆时，本仓库文档仍可阅读，跨仓库跳转需补齐相应目录。
