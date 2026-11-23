import { ApiError, errorMessage } from "../api/client";

export function playbackErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError) || error.status === 401 || error.status === 403)
    return errorMessage(error);
  const messages: Record<string, string> = {
    UNSUPPORTED: "无法播放此音频，请检查解密或转码插件是否已启用并配置完成，以及音频文件是否完整。",
    PLUGIN_DISABLED: "播放所需的插件已禁用，请启用相关插件后重试。",
    RESOURCE_CHANGED: "曲目来源已变更或无法读取，请重新扫描该来源后播放。",
    SOURCE_OFFLINE: "音乐来源暂不可用，请检查音乐目录及其所在磁盘或网络连接后重试。",
    SOURCE_UNAVAILABLE: "音乐来源暂不可用，请检查音乐目录及其所在磁盘或网络连接后重试。",
  };
  const message = messages[error.code];
  if (!message) return errorMessage(error);
  return error.requestId ? `${message} 请求编号：${error.requestId}` : message;
}
