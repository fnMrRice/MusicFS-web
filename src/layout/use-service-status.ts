import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useServices, useStore } from "../app/services";

export type ServicePhase = "checking" | "ready" | "not-ready" | "unreachable" | "incompatible" | "changed" | "error";
interface ServiceStatus { phase: ServicePhase; checkedAt: number | null; checking: boolean }

export function useServiceStatus() {
  const services = useServices();
  const instanceId = useStore(services.auth).ready?.instanceId;
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<ServiceStatus>({ phase: "checking", checkedAt: null, checking: true });

  useEffect(() => {
    let disposed = false;
    let request: AbortController | null = null;
    const publish = (phase: ServicePhase) => setStatus({ phase, checkedAt: Date.now(), checking: false });
    const offline = () => {
      request?.abort();
      request = null;
      publish("unreachable");
    };
    const check = async () => {
      if (disposed || request || document.visibilityState === "hidden") return;
      if (!navigator.onLine) { offline(); return; }
      const controller = new AbortController();
      request = controller;
      setStatus((previous) => ({ ...previous, checking: true }));
      try {
        const health = await services.authApi.ready(controller.signal, 5_000);
        if (disposed || controller.signal.aborted) return;
        if (!health || health.product !== "MusicFS" || health.apiVersion !== "1" ||
          typeof health.ready !== "boolean" || typeof health.instanceId !== "string" || !health.instanceId.trim()) {
          publish("incompatible");
        } else if (health.instanceId !== instanceId) {
          publish("changed");
        } else {
          publish(health.ready ? "ready" : "not-ready");
        }
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        // 就绪接口在服务暂不可用时返回 503；网络失败与协议错误单独展示。
        publish(error instanceof ApiError && error.status === 503 ? "not-ready"
          : error instanceof ApiError && ["NETWORK_ERROR", "TIMEOUT"].includes(error.code) ? "unreachable"
          : error instanceof ApiError && error.code === "INVALID_RESPONSE" ? "incompatible" : "error");
      } finally {
        if (request === controller) request = null;
      }
    };
    const refresh = () => { void check(); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      request?.abort();
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [services, instanceId, revision]);

  return { ...status, refresh: () => setRevision((value) => value + 1) };
}
