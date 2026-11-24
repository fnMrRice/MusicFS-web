import { ControlChannel, type ControlSocket } from "../api/control-channel";
import { ActivityEvents } from "./activity-events";
import { DownloadEvents } from "./download-events";

/** 能力通知触发授权查询，任务队列直接消费当前订阅的快照。 */
export class CapabilityEvents {
  readonly channel: ControlChannel;
  readonly activity = new ActivityEvents();
  readonly downloads = new DownloadEvents();
  private previous: string | null = null;

  constructor(
    invalidate: () => void,
    checkSession: (signal: AbortSignal) => Promise<unknown>,
    unauthorized: () => void,
    instanceChanged: () => void,
    tasks: { ready(): void; disconnected(): void; receive(data: unknown): void },
    create?: (url: string, protocol: string) => ControlSocket,
    address?: () => string,
  ) {
    this.channel = new ControlChannel({
      ready: () => { this.previous = null; invalidate(); this.activity.ready(); this.downloads.ready(); tasks.ready(); },
      checkSession, unauthorized, instanceChanged,
      disconnected: () => tasks.disconnected(),
      event: (name, data) => {
        if (name === "downloads.progress") { this.downloads.receive(data); return; }
        if (name === "tasks.snapshot") { tasks.receive(data); return; }
        if (name === "activity.changed") { this.activity.receive(data); return; }
        if (name !== "capabilities.changed" || !data || typeof data !== "object") return;
        const { revision, sequence } = data as Record<string, unknown>;
        if (typeof revision !== "string" || revision.length > 256 || typeof sequence !== "number"
          || !Number.isSafeInteger(sequence) || sequence < 0) return;
        const current = JSON.stringify([revision, sequence]);
        if (this.previous === current) return;
        this.previous = current;
        invalidate();
        this.activity.invalidate("configuration");
      },
    }, create, address);
  }

  start(identity: string): void { this.channel.start(identity); }
  stop(): void { this.channel.stop(); }
}
