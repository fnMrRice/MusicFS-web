import { tr } from "../../i18n";

export function syncFailureMessage(code: string) {
  switch (code) {
    case "RATE_LIMITED": return tr("歌单同步触发请求上限，服务端会在冷却后自动重试。");
    case "PLATFORM_AUTH_REQUIRED": case "AUTH_REQUIRED": case "AUTH_EXPIRED": case "ACCESS_DENIED":
      return tr("请在设置中确认音乐平台账号已登录，并且可以读取这张歌单。");
    case "RESOURCE_CHANGED": case "CONFLICT": return tr("来源或歌单已发生变化，请重新同步。");
    case "SOURCE_OFFLINE": case "PLUGIN_DISABLED": return tr("音乐来源暂不可用，请检查插件状态后重试。");
    case "NOT_FOUND": return tr("平台未找到这张歌单，请确认它仍可访问。");
    default: return tr("这次同步未完成，已有内容仍然保留。");
  }
}
