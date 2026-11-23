import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentApi, Observation, OnlineInstance } from "../../api/content";
import { errorMessage } from "../../api/client";
import { useForeground } from "../../components/use-foreground";

export function usePlaylistObservation(api: ContentApi, source: OnlineInstance, external: string) {
  const { instanceId, platform } = source;
  const active = useRef<AbortController | null>(null);
  const lastForce = useRef(false);
  const [state, setState] = useState<{ data: Observation | null; loading: boolean; error: string | null }>({
    data: null, loading: true, error: null,
  });
  const read = useCallback(async (force: boolean, background = false) => {
    if (background && active.current) return;
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    lastForce.current = force;
    if (!background) setState({ data: null, loading: true, error: null });
    try {
      const data = await api.observation(instanceId, external, request.signal, platform === "netease" && force);
      if (!request.signal.aborted) setState({ data, loading: false, error: null });
    } catch (error) {
      if (!request.signal.aborted) setState({ data: null, loading: false, error: errorMessage(error) });
    } finally {
      if (active.current === request) active.current = null;
    }
  }, [api, instanceId, external, platform]);
  useEffect(() => {
    void read(false);
    return () => active.current?.abort();
  }, [read]);
  useForeground(platform === "netease", () => void read(false, true));
  return { ...state, refresh: () => void read(true), retry: () => void read(lastForce.current) };
}
