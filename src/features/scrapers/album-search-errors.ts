import { ApiError, errorMessage, withRequestId } from "../../api/client";
import { scraperSearchMessage, type Scraper } from "../../api/scrapers";

// 只展示本流程主动生成的提示，未知异常继续使用统一错误边界。
export class AlbumLookupError extends Error {}

export function albumLookupMessage(cause: unknown, pageLookup = false, sources?: readonly Scraper[]) {
  if (cause instanceof AlbumLookupError) return cause.message;
  if (pageLookup && cause instanceof ApiError && ["INVALID_ARGUMENT", "UNSUPPORTED"].includes(cause.code))
    return withRequestId("请检查资料平台和专辑页面地址。", cause);
  return scraperSearchMessage(cause, sources);
}

export function albumSaveMessage(cause: unknown, operation: "selection" | "merge" | "links") {
  if (cause instanceof ApiError && cause.status === 400 && cause.code === "INVALID_ARGUMENT") {
    if (operation !== "links" && cause.message === "Invalid music library metadata")
      return withRequestId("平台返回的曲名或其他音乐资料格式不符合曲库要求。请核对平台资料，或尝试其他发行版。", cause);
    const messages = {
      selection: "这份专辑资料未通过保存校验。请返回搜索结果，核对发行版和完整曲目表，或改选其他版本。",
      merge: "选中的专辑资料未通过合并校验。请核对勾选的字段和平台曲目表。",
      links: "专辑页面关联未通过校验。每个平台可关联一个 HTTPS 专辑页面，最多可关联 32 个平台。",
    };
    return withRequestId(messages[operation], cause);
  }
  return errorMessage(cause);
}
