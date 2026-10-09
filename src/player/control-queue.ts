import { ApiError } from '../api/client';
import type { ObservedError, Playback } from '../api/types';

interface Intent { kind: 'seek' | 'recover'; positionMs: number; observedError?: ObservedError }
export type ControlSender = (descriptor: Playback, intent: Intent, key: string, signal: AbortSignal) => Promise<Playback>;
export function isUncertain(error: unknown): boolean {
  return error instanceof ApiError && ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'].includes(error.code);
}

export class ControlQueue {
  private pending: Intent | null = null;
  private running = false;
  private active = true;
  private controller = new AbortController();
  private reported = new Set<string>();
  constructor(private current: Playback, private send: ControlSender,
    private confirm: (descriptor: Playback, apply: boolean) => void,
    private fail: (error: unknown) => void) {}
  seek(positionMs: number): void { this.enqueue({ kind: 'seek', positionMs }); }
  recover(positionMs: number, observedError: ObservedError): void {
    if (this.reported.has(this.current.attemptId) || this.pending?.kind === 'seek') return;
    this.reported.add(this.current.attemptId); this.enqueue({ kind: 'recover', positionMs, observedError });
  }
  dispose(): void { this.active = false; this.pending = null; this.controller.abort(); }
  private enqueue(intent: Intent): void {
    if (!this.active) return;
    this.pending = intent;
    if (!this.running) void this.drain();
  }
  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.active && this.pending) {
        const intent = this.pending; this.pending = null;
        const key = crypto.randomUUID(); const expected = this.current;
        let result: Playback | null = null;
        for (let retry = 0; retry < 2; retry++) {
          try { result = await this.send(expected, intent, key, this.controller.signal); break; }
          catch (error) {
            if (!this.active) return;
            if (!isUncertain(error)) throw error;
            if (retry === 1) throw new ApiError('OUTCOME_UNKNOWN', 'Control outcome could not be confirmed');
          }
        }
        if (!this.active || !result) return;
        if (result.sessionId !== expected.sessionId) throw new ApiError('INVALID_RESPONSE', 'Control changed session');
        this.current = result;
        this.confirm(result, !this.pending);
      }
    } catch (error) {
      this.active = false; this.pending = null; this.fail(error);
    } finally { this.running = false; }
  }
}
