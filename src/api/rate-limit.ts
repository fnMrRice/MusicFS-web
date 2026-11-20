import { ApiError } from "./client";

/** 平台账号的读请求及天然幂等操作遇到短时限流时，按服务端提供的等待时间重试。 */
export async function withRateLimitRetry<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; ++attempt) {
    try { return await request(); }
    catch (error) {
      if (!(error instanceof ApiError) || error.code !== "RATE_LIMITED" || attempt >= 2 ||
          signal?.aborted || (error.retryAfter ?? 1) > 10) throw error;
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(new ApiError("CANCELLED", "Request cancelled")); };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", cancel);
          resolve();
        }, Math.max(1, error.retryAfter ?? 1) * 1000);
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    }
  }
}
