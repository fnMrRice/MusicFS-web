import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import type { MatchingMutation, MatchingRequest } from "../../api/matching";
import { useServices } from "../../app/services";

export function useDecision(changed: (result: MatchingMutation) => void) {
  const services = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const pending = useRef<{ request: MatchingRequest; key: string } | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(request?: MatchingRequest) {
    if (running.current || conflict) return;
    if (!pending.current && services.matchingDecisions.pending.value.length > 0) return;
    if (!pending.current && request) pending.current = { request, key: crypto.randomUUID() };
    if (!pending.current) return;
    running.current = true;
    setBusy(true); setError(null);
    try {
      const result = await services.matchingDecisions.submit(pending.current.request, pending.current.key);
      if (!mounted.current) return;
      pending.current = null; setRetryable(false);
      changed(result);
    } catch (cause) {
      if (!mounted.current) return;
      const expired = cause instanceof ApiError && (cause.status === 410 || cause.code === "IDEMPOTENCY_EXPIRED");
      const stale = expired || cause instanceof ApiError && (cause.status === 409 || cause.status === 412 || cause.code === "REVISION_CONFLICT");
      const uncertain = services.matchingDecisions.pending.value.some((item) => item.key === pending.current?.key);
      setConflict(stale); setRetryable(!stale && uncertain);
      if (!uncertain) pending.current = null;
      setError(expired ? "上次操作的确认记录已过期，请刷新曲库检查结果后重新选择。" :
        stale ? "歌曲关联已发生变化，请刷新列表后重新选择。" : errorMessage(cause));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function reset() {
    if (running.current) return;
    pending.current = null; setError(null); setConflict(false); setRetryable(false);
  }
  return { busy, error, conflict, retryable, run, reset };
}
