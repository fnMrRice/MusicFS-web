import { useRef, useState, useSyncExternalStore } from "react";
import { ApiError, errorMessage, randomRequestId } from "../api/client";
import { taskActive, type CatalogTaskRequest, type Task } from "../api/tasks";
import { useServices } from "../app/services";

export function useCatalogTask() {
  const { tasks } = useServices();
  const pending = useRef<{ request: CatalogTaskRequest; key: string } | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<Task | null>(null);
  const active = useSyncExternalStore(tasks.subscribe, () =>
    accepted !== null && tasks.value.items.some(task => task.id === accepted.id && taskActive(task)));
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  async function submit(request: CatalogTaskRequest) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true); setAccepted(null); setError(null);
    pending.current ??= { request, key: randomRequestId() };
    try {
      const task = await tasks.enqueue(pending.current.request, pending.current.key);
      pending.current = null;
      setAccepted(task); setRetryable(false);
    } catch (cause) {
      const rejected = cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 408;
      if (rejected) pending.current = null;
      setRetryable(!rejected); setError(errorMessage(cause));
    } finally {
      sending.current = false; setBusy(false);
    }
  }
  return { busy, active, submitted: accepted !== null, retryable, error, submit };
}
