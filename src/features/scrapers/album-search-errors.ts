import { ApiError, errorMessage } from "../../api/client";
import { tr } from "../../i18n";

// 只展示本流程主动生成的提示，未知异常继续使用统一错误边界。
export class AlbumLookupError extends Error {}

export function albumLookupMessage(cause: unknown, pageLookup = false) {
  if (cause instanceof AlbumLookupError) return cause.message;
  if (pageLookup && cause instanceof ApiError && ["INVALID_ARGUMENT", "UNSUPPORTED"].includes(cause.code))
    return tr("请检查资料平台和专辑页面地址。");
  return errorMessage(cause);
}
