# Web 测试

在 Web 仓库根目录执行 `npm ci` 后，按要验证的行为选择命令。

| 命令 | 验证范围 |
| --- | --- |
| `npm test` | 运行 Vitest 单元测试，覆盖 API 响应、分页、曲库状态、播放队列与音频处理逻辑。 |
| `npm run build` | 检查源码和测试的 TypeScript 类型，生成浏览器测试需要的 `dist/`。 |
| `npm run test:e2e` | 使用 Playwright 在 Microsoft Edge 中运行界面测试和服务端联调。 |

## 浏览器测试

先安装 Microsoft Edge，再运行 `npm run build`。全量测试还需要与 Web 同级的 [MusicFS Server](https://github.com/fnMrRice/MusicFS-server)、服务端要求的 Go 工具链，以及 FFmpeg 和 ffprobe。将 `MUSICFS_E2E_FFMPEG` 和 `MUSICFS_E2E_FFPROBE` 分别设为两个可执行文件的绝对路径。

```sh
npm run test:e2e
```

要单独运行一组用例，可将测试文件名传给 Playwright。

- `npm run test:e2e -- categories-mock.spec.ts` 使用模拟 API 验证分类浏览、专辑视图切换与曲目封面。
- `npm run test:e2e -- ncm.spec.ts` 启动隔离的 Server 与插件，以合成 NCM 文件验证扫描、播放和错误处理。

联调用例使用临时凭据、独立数据目录和[合成媒体样本](fixtures/README.md)。Playwright 报告与媒体检测结果保存在 `test-results/`。
