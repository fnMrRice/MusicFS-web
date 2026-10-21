export interface ScanJobObservation {
  status: string;
  error?: { code: string; message: string } | null;
}

// 此有界等待器用于真实服务端测试的数据准备；页面扫描交互由独立状态管理。
export async function waitForScanJob(
  load: (timeoutMs: number) => Promise<ScanJobObservation>,
  options: { timeoutMs?: number; pollMs?: number; onRetry?: () => void } = {},
): Promise<ScanJobObservation> {
  const timeout = options.timeoutMs ?? 90_000; const interval = options.pollMs ?? 250;
  if (timeout <= 0 || interval <= 0) throw new Error('Invalid scan wait deadline');
  const deadline = Date.now() + timeout; let previous = '';
  for (let attempt = 0; attempt <= Math.ceil(timeout / interval); attempt++) {
    const remaining = deadline - Date.now(); if (remaining <= 0) break;
    const job = await load(Math.min(10_000, remaining));
    if (['succeeded', 'failed', 'cancelled', 'paused'].includes(job.status)) return job;
    if (!['queued', 'running', 'retry_wait'].includes(job.status)) throw new Error('Unknown scan job status');
    // A retry keeps its last error even while running. Status determines
    // completion; the presence of that error must not stop the current attempt.
    if (job.status === 'retry_wait' && previous !== 'retry_wait') options.onRetry?.();
    previous = job.status;
    const delay = Math.min(interval, deadline - Date.now()); if (delay <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error('Scan wait timed out; inspect the existing job before submitting another scan');
}

export function scanFailureMessage(job: ScanJobObservation): string {
  if (job.status === 'paused') return 'Scan paused; fix the source or authorization problem and submit a new scan with a new idempotency key';
  return `Scan ended with status ${job.status}${job.error?.code ? ` (${job.error.code})` : ''}`;
}
