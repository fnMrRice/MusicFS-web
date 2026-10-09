export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0, public requestId?: string, public retryAfter?: number) {
    super(message); this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: string; body?: unknown; signal?: AbortSignal; idempotencyKey?: string;
  bearer?: string; timeoutMs?: number; keepalive?: boolean;
}

export class ApiClient {
  csrfToken: string | null = null;
  onUnauthorized: (() => void) | null = null;
  constructor(private fetcher: typeof fetch = fetch) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) cancel();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), options.timeoutMs ?? 15_000);
    const method = options.method ?? 'GET';
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.bearer) headers.set('Authorization', `Bearer ${options.bearer}`);
    if (this.csrfToken && method !== 'GET') headers.set('X-CSRF-Token', this.csrfToken);
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
    try {
      const response = await this.fetcher(`/api/v1${path}`, {
        method, headers, credentials: 'same-origin', signal: controller.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body), keepalive: options.keepalive,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: Record<string, unknown> } | null;
        const detail = data?.error;
        if (response.status === 401 && !options.bearer) this.onUnauthorized?.();
        throw new ApiError(typeof detail?.code === 'string' ? detail.code : 'HTTP_ERROR',
          typeof detail?.message === 'string' ? detail.message : 'Request failed', response.status,
          typeof detail?.requestId === 'string' ? detail.requestId : undefined,
          typeof detail?.retryAfter === 'number' ? detail.retryAfter : undefined);
      }
      if (response.status === 204) return undefined as T;
      try { return await response.json() as T; }
      catch { throw new ApiError('INVALID_RESPONSE', 'Server returned invalid JSON', response.status); }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted) throw new ApiError('CANCELLED', 'Request cancelled');
      if (controller.signal.aborted) throw new ApiError('TIMEOUT', 'Request timed out');
      throw new ApiError('NETWORK_ERROR', 'Unable to connect to Server');
    } finally {
      clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel);
    }
  }
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '发生异常，请重试。';
  const messages: Record<string, string> = {
    CANCELLED: '操作已取消。', TIMEOUT: '请求超时，请重试。', NETWORK_ERROR: '无法连接 Server，请检查连接。',
    CURSOR_EXPIRED: '列表版本已过期，正在重新读取。', INVALID_RESPONSE: 'Server 返回了无法识别的数据。',
    RECOVERY_EXHAUSTED: '自动恢复已用尽，请重新播放。', ATTEMPT_CONFLICT: '播放状态已改变，请重新播放。',
    OUTCOME_UNKNOWN: '无法确认上次操作结果，请重新播放。', SOURCE_UNAVAILABLE: '来源暂不可用，请检查音乐目录。',
  };
  const message = error.status === 401 ? '登录已失效，请重新登录。' : error.status === 403 ? '无权执行此操作。'
    : messages[error.code] ?? '操作失败，请重试或检查 Server 状态。';
  return error.requestId ? `${message} 请求编号：${error.requestId}` : message;
}
