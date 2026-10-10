# MusicFS-web

MusicFS 的 TypeScript + React 浏览器界面。已按共享设计重建深色／浅色外壳、曲目列表、搜索、推荐、歌单管理与详情、专辑和设置。Web 顶部只保留设置、换肤；桌面 Client 独立安排。

旧原生 DOM 页面已移除，保留并扩展原有鉴权与播放核心。提供固定播放器、播放／暂停、音量、进度、会话队列与列表循环；支持连续滚动、常驻复选框和添加到歌单。接口缺失的页面保留说明，不使用生产假数据。验证范围见 [React 交付记录](docs/react-validation.md)；人工听音不由自动化结果代替。

已接入 Server 的本地 NCM 解密播放：独立合成 MP3/FLAC 封装的真实 Edge 验证通过，页面区分“服务端解密输出”与“服务端解密并转码输出”。启用方式见 [Server NCM 配置](../server/docs/ncm.md)，证据与限制见 [NCM 验证记录](docs/ncm-validation.md)；这不代表在线网易云来源或全部真实 NCM 变体已兼容。

## 启动与构建

固定环境：Node.js **26.3.1**、npm **11.16.0**。React / React DOM 19.3.0、React Router 7.18.4、TypeScript 5.9.3、Vite 8.3.4；具体依赖由 `package-lock.json` 锁定。

```powershell
npm ci
npm run dev
```

开发页面为 `http://127.0.0.1:5173`，默认代理至 `http://127.0.0.1:8080`。Server 必须显式允许开发页面的 Origin。需要其他 Server 端口时，在启动开发服务前设置 `$env:MUSICFS_DEV_SERVER`；该地址仅用于开发服务器，不写入浏览器制品。

Server 配置采用 `configVersion: 1` 的 YAML；插件及实例在 `plugins` 中显式配置并启用，旧 JSON 配置不兼容。配置模型与读写边界见 [Server YAML 配置](../server/docs/configuration.md)。修改后按运行说明重启应用；Web 本期不提供插件动态启停界面。

```powershell
npm run typecheck
npm test
npm run build
```

交付目录为 `dist/`，包含 `version.json`。所有运行时 API 地址均为同源相对路径；构建不需要 token。生产可使用静态站点加同源 `/api` 反向代理，也可按 [Server README](../server/README.md) 启动时加 `--web-root` 指向 `dist`。

## 最短播放步骤

界面默认跟随浏览器语言，支持英文、简体中文、繁体中文和日语。登录页或设置页可手动切换；选择保存在当前浏览器。详见[多语言说明](docs/internationalization.md)。

1. 按 Server 文档配置音乐目录、FFmpeg/插件、鉴权及允许的 Origin，启动 Server。
2. 在页面输入显式配置的管理员登录令牌。成功后输入会清空，刷新依靠 HttpOnly cookie 恢复；令牌不写浏览器持久存储。
3. 使用 Server 管理 API 对音乐目录执行扫描，返回页面点击“刷新列表”。目录与扫描均由 Server 管理。
4. 点击曲名开始播放，使用底部播放／暂停、音量和进度控件；“停止”释放会话。路由切换不打断播放。
5. 在设置中勾选“服务端处理”后再次选择曲目，请求 -6 dB 效果。底部进度始终映射整首曲目时间；处理输出的定位仍走服务端串行控制。
6. 勾选曲目可加入队列或个人歌单。歌单规则保存后，在详情点击“更新歌单快照”；远程歌单需显式导入、同步，再添加聚合规则。

首次运行的完整配置和扫描命令见 [Server 本地运行说明](../server/docs/running.md)；逐项操作及预期见 [手动验收](docs/manual-validation.md)。NCM 播放无需另勾处理选项，配置插件并重新扫描后直接选曲。

## 真实浏览器测试

```powershell
npm run build
npm run test:e2e
```

测试需要同级 Server 仓库、Go、已安装的 Microsoft Edge，以及 FFmpeg/ffprobe。使用 `MUSICFS_E2E_FFMPEG`、`MUSICFS_E2E_FFPROBE` 指定可执行文件；当前机器的已验证默认路径见测试启动器。测试构建自己的 Server 与插件，在 `127.0.0.1:18081` 启动全新实例，使用独立 `.e2e-runtime/` 数据目录、临时 `config.yaml` 与每次随机生成的临时凭据，不访问个人音乐库。YAML 为实际缩进映射和序列；管理员令牌只通过环境变量传给 Server，不写入配置。

样本来自 Server 的 CC0 合成音频；包含中文文件名、损坏/零字节文件、分页副本、600 秒循环 AIFF，以及独立生成的 NCM MP3/FLAC。`playback.spec.ts` 和 `ncm.spec.ts` 读取真实 API 与媒体，记录非零 PCM 信号。`ui.spec.ts` 包含真实歌单／播放器检查，以及名称明确标注 Mock 的 1,000 行列表和在线搜索测试；Mock 不证明平台现网能力。仅运行 NCM 可用 `npm run test:e2e -- ncm.spec.ts`。临时输出忽略于 Git，人工听音需单独验证。

## 当前限制

- 专辑／歌手／歌单搜索、本地关键词搜索、全库组合筛选与排序、收藏和历史尚缺接口，页面保留待支持状态。由 Server 设计接口，见[缺口交接](../server/docs/web-ui-api-gaps.md)。
- 在线曲目搜索仅提供资料，不代表音频可播放；推荐和远程歌单受平台可用性限制。
- 歌单快照只返回来源引用，当前本地详情通过固定修订全库关联展示；大库应由 Server 后续补充批量展示读取能力。远程引用暂不伪造曲目名称和播放。
- 封面和歌词可在播放器面板读取当前受鉴权选用内容；列表封面仍使用统一占位，歌词不逐句同步。
- 只消费 Server 已验证的无变速时间映射；恢复预算耗尽或结果不明时要求显式从头播放。
- Windows Edge 的实测结果不代表 Firefox、Safari 或全部设备支持；见兼容性记录。
- 页面关闭通知只能尽力发送，Server 负责会话超时与进程回收。

接口现状见 [React UI 接口清单](docs/react-api-readiness.md)。前端使用 hash 路由，静态托管无需额外路径回退；主题、音量和分组偏好按实例／账号隔离保存，队列只属于当前浏览器会话。

## 设计文档

- [React 界面开发方案](docs/react-development.md)：确认的 Web 差异、TS/React 迁移、组件与路由、动态加载、播放接入和分阶段验收。
- [React UI 接口清单](docs/react-api-readiness.md)：当前可复用契约、待补接口和能力不足时的界面行为。
- [分阶段实现计划](docs/implementation.md)：P0—P8 的文件组织、逐步任务、最小页面、鉴权、播放状态和真实媒体验收。
- [实施记录](docs/progress.md)：稳定步骤编号、验证结果与残留限制。
- [兼容性记录](docs/compatibility.md)：实际浏览器与媒体链路证据。
- [手动验收](docs/manual-validation.md)：登录、播放、处理、定位、刷新、错误恢复及退出的操作与预期。
- [NCM 验证记录](docs/ncm-validation.md)：独立合成样本、配置入口、真实浏览器证据及未测范围。
- [Web 设计](docs/design.md)：浏览器职责、能力探测、播放与状态适配。
- [Server 实现计划](../server/docs/implementation.md)：Go Server、插件与对应联调阶段。
- [Server YAML 配置](../server/docs/configuration.md)：配置版本、插件/实例模型、读写服务及应用边界。
- [跨端架构](../docs/architecture.md)：数据语义、API、播放协商、定位和恢复。
- [Server 音频处理](../server/docs/audio-processing.md)：服务端输出能力与约束。
- [工作约定](AGENTS.md)：仓库工作约定。

本仓库独立管理，浏览器内部设计放在 `docs/`。跨仓库相对链接以本仓库检出到 MusicFS 根目录的 `web/` 为前提；单独克隆时，本仓库文档仍可阅读，跨仓库跳转需补齐相应目录。
