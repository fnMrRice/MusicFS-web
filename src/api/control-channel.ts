import { ApiError, randomRequestId, type ControlTransport, type RequestOptions } from "./client";
import { ControlStatus } from "./control-status";

export interface ControlSocket {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Pending {
  sent: boolean;
  mutation: boolean;
  frame: string;
  resolve(value: unknown): void;
  reject(error: ApiError): void;
  cleanup(): void;
  onLateSuccess?: (value: unknown) => void;
}

interface Callbacks {
  ready(): void;
  disconnected?(): void;
  event(name: string, data: unknown): void;
  checkSession(signal: AbortSignal): Promise<unknown>;
  unauthorized(): void;
  instanceChanged(): void;
}

/** 登录会话独占一个控制通道；断线只恢复连接，绝不重放已发送命令。 */
export class ControlChannel implements ControlTransport {
  readonly status = new ControlStatus();
  private socket: ControlSocket | null = null;
  private identity = "";
  private generation = 0;
  private connected = false;
  private instanceId = "";
  private retry = 0;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private handshake: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private checking: AbortController | null = null;
  private detach: (() => void) | null = null;
  private pending = new Map<string, Pending>();
  private late = new Map<string, { complete(value: unknown): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    private callbacks: Callbacks,
    private create: (url: string, protocol: string) => ControlSocket = (url, protocol) => new WebSocket(url, protocol),
    private address: () => string = () => {
      const url = new URL("/api/v1/control", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url.href;
    },
  ) {}

  start(identity: string): void {
    if (this.identity === identity && identity) return;
    this.stop();
    if (!identity) return;
    this.identity = identity;
    this.status.set("checking");
    this.open();
  }

  stop(): void {
    ++this.generation;
    this.identity = "";
    this.instanceId = "";
    this.retry = 0;
    if (this.reconnect) clearTimeout(this.reconnect);
    this.reconnect = null;
    this.checking?.abort();
    this.checking = null;
    this.closeSocket();
    this.status.set("unreachable");
    this.rejectPending("CANCELLED");
  }

  request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(new ApiError("CANCELLED", "Request cancelled"));
    if (!this.identity) return Promise.reject(new ApiError("NETWORK_ERROR", "Control channel is unavailable"));
    if (this.pending.size + this.late.size >= 128) return Promise.reject(new ApiError("NETWORK_ERROR", "Too many pending control requests"));
    const id = randomRequestId();
    const method = options.method ?? "GET";
    return new Promise<T>((resolve, reject) => {
      const cancel = () => { this.retainCleanup(id); this.finish(id, new ApiError("CANCELLED", "Request cancelled")); };
      const timer = setTimeout(() => {
        const item = this.pending.get(id);
        this.retainCleanup(id);
        this.finish(id, new ApiError(item?.sent && item.mutation ? "OUTCOME_UNKNOWN" : "TIMEOUT", "Control request timed out"));
      }, options.timeoutMs ?? 15_000);
      this.pending.set(id, {
        sent: false, mutation: method !== "GET", resolve: (value) => resolve(value as T), reject,
        onLateSuccess: options.onLateSuccess,
        frame: JSON.stringify({ type: "request", id, method, path, body: options.body, idempotencyKey: options.idempotencyKey }),
        cleanup: () => { clearTimeout(timer); options.signal?.removeEventListener("abort", cancel); },
      });
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (this.connected) this.flush();
    });
  }

  private open(): void {
    if (!this.identity) return;
    const generation = this.generation;
    let socket: ControlSocket;
    try { socket = this.create(this.address(), "musicfs.control.v1"); }
    catch { this.disconnected(generation); return; }
    this.socket = socket;
    const current = () => this.socket === socket && generation === this.generation;
    const failed: EventListener = () => { if (current()) this.disconnected(generation); };
    const opened: EventListener = () => {
      if (!current()) return;
      try { socket.send(JSON.stringify({ type: "auth", csrfToken: this.identity })); }
      catch { failed(new Event("error")); }
    };
    const message: EventListener = (event) => {
      if (!current()) return;
      const data: unknown = (event as MessageEvent).data;
      if (typeof data !== "string" || data.length > 2_097_152) return;
      try {
        const frame: unknown = JSON.parse(data);
        if (frame && typeof frame === "object") this.receive(frame as Record<string, unknown>);
      } catch { /* 无效消息不能改变已授权状态。 */ }
    };
    for (const [name, listener] of [["open", opened], ["message", message], ["close", failed], ["error", failed]] as const)
      socket.addEventListener(name, listener);
    this.detach = () => {
      for (const [name, listener] of [["open", opened], ["message", message], ["close", failed], ["error", failed]] as const)
        socket.removeEventListener(name, listener);
    };
    this.handshake = setTimeout(() => { if (current()) this.disconnected(generation); }, 10_000);
  }

  private lastPong = 0;
  private receive(frame: Record<string, unknown>): void {
    if (frame.type === "ready" && !this.connected) {
      const interval = frame.heartbeatIntervalMs, timeout = frame.heartbeatTimeoutMs;
      if (typeof frame.instanceId !== "string" || !frame.instanceId.trim() || typeof interval !== "number" || typeof timeout !== "number"
        || !Number.isFinite(interval) || !Number.isFinite(timeout) || interval < 1000 || interval > 60_000 || timeout <= interval || timeout > 180_000) return;
      if (this.instanceId && this.instanceId !== frame.instanceId) {
        this.stop();
        this.callbacks.instanceChanged();
        return;
      }
      this.instanceId = frame.instanceId;
      this.connected = true;
      this.status.set("online");
      this.retry = 0;
      if (this.handshake) clearTimeout(this.handshake);
      this.handshake = null;
      this.lastPong = Date.now();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastPong >= timeout) { this.disconnected(this.generation); return; }
        try { this.socket?.send(JSON.stringify({ type: "ping" })); }
        catch { this.disconnected(this.generation); }
      }, interval);
      this.callbacks.ready();
      this.flush();
      return;
    }
    if (!this.connected) return;
    if (frame.type === "pong") { this.lastPong = Date.now(); this.status.touch(); return; }
    if (frame.type === "event" && typeof frame.event === "string") {
      if (frame.event === "lifecycle.changed" && frame.data && typeof frame.data === "object") {
        const { instanceId, state } = frame.data as Record<string, unknown>;
        if (instanceId === this.instanceId && typeof state === "string" && ["starting", "ready", "draining", "stopped"].includes(state))
          this.status.set(state === "ready" ? "ready" : "not-ready");
      }
      this.callbacks.event(frame.event, frame.data); return;
    }
    if (frame.type !== "response" || typeof frame.id !== "string" || (!this.pending.has(frame.id) && !this.late.has(frame.id))
      || typeof frame.status !== "number" || !Number.isInteger(frame.status) || frame.status < 200 || frame.status > 599) return;
    const late = this.late.get(frame.id);
    if (late) {
      clearTimeout(late.timer); this.late.delete(frame.id);
      if (frame.status < 300) late.complete(frame.body);
      if (frame.status === 401) this.callbacks.unauthorized();
      return;
    }
    if (frame.status < 300) { this.finish(frame.id, null, frame.body); return; }
    const detail = (frame.body as { error?: Record<string, unknown> } | undefined)?.error;
    this.finish(frame.id, new ApiError(
      typeof detail?.code === "string" ? detail.code : "HTTP_ERROR",
      typeof detail?.message === "string" ? detail.message : "Control request failed", frame.status,
      typeof detail?.requestId === "string" ? detail.requestId : undefined,
      typeof detail?.retryAfter === "number" ? detail.retryAfter : undefined,
    ));
    if (frame.status === 401) this.callbacks.unauthorized();
  }

  private flush(): void {
    if (!this.connected || !this.socket) return;
    for (const item of this.pending.values()) {
      if (item.sent) continue;
      item.sent = true;
      try { this.socket.send(item.frame); }
      catch { this.disconnected(this.generation); return; }
    }
  }

  private finish(id: string, error: ApiError | null, body?: unknown): void {
    const item = this.pending.get(id);
    if (!item) return;
    this.pending.delete(id);
    item.cleanup();
    if (error) item.reject(error); else item.resolve(body);
  }

  private retainCleanup(id: string): void {
    const item = this.pending.get(id);
    if (!item?.sent || !item.onLateSuccess || this.late.size >= 128) return;
    // 取消等待并不取消服务端创建；短暂保留同一连接内迟到结果的资源清理。
    this.late.set(id, { complete: item.onLateSuccess, timer: setTimeout(() => this.late.delete(id), 30_000) });
  }

  private rejectPending(code?: "CANCELLED"): void {
    for (const [id, item] of this.pending)
      this.finish(id, new ApiError(code ?? (item.sent && item.mutation ? "OUTCOME_UNKNOWN" : "NETWORK_ERROR"), "Control connection closed"));
  }

  private closeSocket(): void {
    this.connected = false;
    this.detach?.();
    this.detach = null;
    const socket = this.socket;
    this.socket = null;
    for (const item of this.late.values()) clearTimeout(item.timer);
    this.late.clear();
    socket?.close(1000, "Control channel closed");
    if (this.handshake) clearTimeout(this.handshake);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.handshake = null;
    this.heartbeat = null;
  }

  private disconnected(generation: number): void {
    if (generation !== this.generation || !this.identity || this.reconnect) return;
    this.closeSocket();
    this.status.set("unreachable");
    this.rejectPending();
    this.callbacks.disconnected?.();
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      if (generation === this.generation) this.open();
    }, Math.min(30_000, 500 * 2 ** Math.min(this.retry++, 6)));
    if (!this.checking) {
      const check = new AbortController();
      this.checking = check;
      void this.callbacks.checkSession(check.signal).catch(() => {}).finally(() => {
        if (this.checking === check) this.checking = null;
      });
    }
  }
}
