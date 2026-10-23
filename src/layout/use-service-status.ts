import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "../api/client";
import { useServices, useStore } from "../app/services";

export type ServicePhase = "checking" | "online" | "ready" | "not-ready" | "unreachable" | "incompatible" | "changed" | "error";
interface ServiceStatus { phase: ServicePhase; checkedAt: number | null; checking: boolean }

export function useServiceStatus() {
  const services = useServices();
  const instanceId = useStore(services.auth).ready?.instanceId;
  const live = useSyncExternalStore(services.controlStatus.subscribe, services.controlStatus.getSnapshot);
  const [manual, setManual] = useState<ServiceStatus | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    request.current?.abort(); request.current = null; setManual(null);
    return () => { request.current?.abort(); request.current = null; };
  }, [instanceId]);

  const refresh = async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    const publish = (phase: ServicePhase) => setManual({ phase, checkedAt: Date.now(), checking: false });
    setManual({ phase: manual?.phase ?? live.phase, checkedAt: Date.now(), checking: true });
    try {
      const health = await services.authApi.ready(controller.signal, 5_000);
      if (controller.signal.aborted) return;
      if (!health || health.product !== "MusicFS" || health.apiVersion !== "1" ||
        typeof health.ready !== "boolean" || typeof health.instanceId !== "string" || !health.instanceId.trim()) {
        publish("incompatible");
      } else if (health.instanceId !== instanceId) {
        publish("changed");
      } else {
        publish(health.ready ? "ready" : "not-ready");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      publish(error instanceof ApiError && error.status === 503 ? "not-ready"
        : error instanceof ApiError && ["NETWORK_ERROR", "TIMEOUT"].includes(error.code) ? "unreachable"
        : error instanceof ApiError && error.code === "INVALID_RESPONSE" ? "incompatible" : "error");
    } finally {
      if (request.current === controller) request.current = null;
    }
  };

  // 心跳和生命周期通知更新角标，HTTP 仅保留用户主动发起的详细健康检查。
  const status = manual && live.phase !== "unreachable" && (manual.checking || (manual.checkedAt ?? 0) >= (live.checkedAt ?? 0))
    ? manual : { ...live, checking: live.phase === "checking" };
  return { ...status, refresh: () => { void refresh(); } };
}
