import { ApiError, errorMessage } from "../api/client";

export function refreshError(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const messages: Record<string, string> = {
    SOURCE_OFFLINE: "音乐来源暂不可用，请检查目录所在磁盘或网络连接后重新刷新。",
    SOURCE_UNAVAILABLE: "音乐来源暂不可用，请检查目录所在磁盘或网络连接后重新刷新。",
    ACCESS_DENIED: "无法访问音乐目录，请检查服务端的目录访问权限后重新刷新。",
    RESOURCE_CHANGED: "目录配置或音乐文件已变化，请重新提交刷新。",
    REVISION_CONFLICT: "目录配置或音乐文件已变化，请重新提交刷新。",
    CONFLICT: "目录配置或音乐文件已变化，请重新提交刷新。",
    SOURCE_TRACK_CHANGED: "目录配置或音乐文件已变化，请重新提交刷新。",
    SCAN_NO_ROOTS: "请先添加本地音乐目录。",
    PLUGIN_DISABLED: "本地音乐插件已禁用，请先在插件设置中启用。",
  };
  return messages[error.code] ?? errorMessage(error);
}
