import { ApiError, errorMessage } from "../api/client";

export function scanFailureReason(code: string): string | null {
  const messages: Record<string, string> = {
    SOURCE_OFFLINE: "音乐来源暂不可用，请检查目录所在磁盘或网络连接后重新扫描。",
    SOURCE_UNAVAILABLE: "音乐来源暂不可用，请检查目录所在磁盘或网络连接后重新扫描。",
    PLUGIN_DISABLED: "本地音乐插件已禁用，请先在插件设置中启用。",
    ACCESS_DENIED: "无法访问音乐目录，请检查服务端的目录访问权限后重新扫描。",
    RESOURCE_CHANGED: "目录配置或音乐文件已变化，请重新发起扫描。",
    REVISION_CONFLICT: "目录配置或音乐文件已变化，请重新发起扫描。",
    AUTH_REQUIRED: "扫描所需的授权已失效，请重新登录后重试。",
    SCAN_NO_ROOTS: "请先添加本地音乐目录。",
  };
  return messages[code] ?? null;
}

export function scanError(error: unknown): string {
  return error instanceof ApiError ? scanFailureReason(error.code) ?? errorMessage(error) : errorMessage(error);
}
