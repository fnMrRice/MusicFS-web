export class RecoveryBudget {
  private attempts = new Set<string>();
  private firstFailure = 0;
  allow(attemptId: string, now = Date.now()): boolean {
    if (this.attempts.has(attemptId)) return false;
    if (!this.firstFailure) this.firstFailure = now;
    if (this.attempts.size >= 2 || now - this.firstFailure > 30_000) return false;
    this.attempts.add(attemptId); return true;
  }
}
