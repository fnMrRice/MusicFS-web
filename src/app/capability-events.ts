import { ControlChannel, type ControlSocket } from "../api/control-channel";
import { ActivityEvents } from "./activity-events";

/** 通知仅使已授权查询失效，不把推送内容直接当作能力或界面状态。 */
export class CapabilityEvents {
  readonly channel: ControlChannel;
  readonly activity = new ActivityEvents();
  private previous: string | null = null;

  constructor(
    invalidate: () => void,
    checkSession: (signal: AbortSignal) => Promise<unknown>,
    unauthorized: () => void,
    instanceChanged: () => void,
    create?: (url: string, protocol: string) => ControlSocket,
    address?: () => string,
  ) {
    this.channel = new ControlChannel({
      ready: () => { this.previous = null; invalidate(); this.activity.ready(); },
      checkSession, unauthorized, instanceChanged,
      event: (name, data) => {
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
