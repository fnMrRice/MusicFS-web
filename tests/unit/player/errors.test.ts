import { afterEach, describe, expect, it } from "vitest";
import { ApiError, errorMessage } from "../../../src/api/client";
import { setLanguage, statusText } from "../../../src/i18n";
import { playbackErrorMessage } from "../../../src/player/errors";

afterEach(() => setLanguage("browser"));

describe("Playback failure messages", () => {
  it("suggests checking plugins and file integrity without changing other unsupported features", () => {
    const error = new ApiError("UNSUPPORTED", "Private decoder details", 415);
    expect(playbackErrorMessage(error)).toContain("解密或转码");
    expect(playbackErrorMessage(error)).toContain("插件是否已启用");
    expect(playbackErrorMessage(error)).toContain("音频文件是否完整");
    expect(playbackErrorMessage(error)).not.toContain("Private");
    expect(errorMessage(error)).toBe("当前来源尚不支持此功能。");
  });

  it("distinguishes disabled plugins from unavailable music sources", () => {
    expect(playbackErrorMessage(new ApiError("PLUGIN_DISABLED", "Private details", 503)))
      .toBe("播放所需的插件已禁用，请启用相关插件后重试。");
    for (const code of ["SOURCE_OFFLINE", "SOURCE_UNAVAILABLE"])
      expect(playbackErrorMessage(new ApiError(code, "Private path", 503)))
        .toBe("音乐来源暂不可用，请检查音乐目录及其所在磁盘或网络连接后重试。");
  });

  it("preserves authentication and unexpected-error handling without exposing details", () => {
    for (const error of [
      new ApiError("UNSUPPORTED", "Private details", 401),
      new ApiError("PLUGIN_DISABLED", "Private details", 403),
      new ApiError("HTTP_ERROR", "Private details", 500),
      new Error("Private details"),
    ]) {
      expect(playbackErrorMessage(error)).toBe(errorMessage(error));
      expect(playbackErrorMessage(error)).not.toContain("Private");
    }
  });

  it("translates playback failures and keeps request IDs after language changes", () => {
    for (const code of ["UNSUPPORTED", "PLUGIN_DISABLED", "SOURCE_OFFLINE"]) {
      const message = playbackErrorMessage(new ApiError(code, "Private details", 503, "req-playback"));
      setLanguage("zh-CN");
      expect(statusText(message)).toBe(message);
      for (const locale of ["en", "zh-TW", "ja"] as const) {
        setLanguage(locale);
        expect(statusText(message)).not.toBe(message);
        expect(statusText(message)).toContain("req-playback");
        expect(statusText(message)).not.toContain("请求编号");
      }
    }
  });
});
