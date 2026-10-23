export type ControlPhase = "checking" | "online" | "ready" | "not-ready" | "unreachable";
export interface ControlSnapshot { phase: ControlPhase; checkedAt: number | null }

/** 连接在线与业务就绪分别记录，远端缺少生命周期事件时不推断就绪。 */
export class ControlStatus {
  private snapshot: ControlSnapshot = { phase: "checking", checkedAt: null };
  private listeners = new Set<() => void>();
  getSnapshot = (): ControlSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  };
  set(phase: ControlPhase): void {
    this.snapshot = { phase, checkedAt: Date.now() };
    this.listeners.forEach(listener => listener());
  }
  touch(): void { this.set(this.snapshot.phase); }
}
