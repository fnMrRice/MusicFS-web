import { ApiError, errorMessage } from "../../api/client";

export function directoryError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "INVALID_ARGUMENT")
      return "目录设置无效，请检查是否重复选择目录或与服务数据目录重叠。";
    if (error.code === "ACCESS_DENIED")
      return "目录不在服务端允许访问的范围内，请重新选择。";
  }
  return errorMessage(error);
}
