import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, errorMessage } from "../api/client";
import { capabilityResources } from "../app/capability-resources";

export function useResource<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<T>,
) {
  const capabilityRevision = useSyncExternalStore(
    capabilityResources.subscribe,
    () => capabilityResources.snapshot(key),
  );
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: true, error: null });
  const [revision, setRevision] = useState(0);
  const load = useRef(loader);
  load.current = loader;
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });
    void load.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted)
          setState({ data, loading: false, error: null });
      },
      (error) => {
        if (!controller.signal.aborted)
          setState({ data: null, loading: false, error: errorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [key, revision, capabilityRevision]);
  return { ...state, reload: () => setRevision((v) => v + 1) };
}
export function usePages<T>(
  key: string,
  loader: (
    cursor: string | null,
    signal: AbortSignal,
  ) => Promise<{ items: T[]; cursor: string | null }>,
  identity: (item: T) => string,
) {
  const [state, setState] = useState<{
    items: T[];
    cursor: string | null;
    loading: boolean;
    error: string | null;
  }>({ items: [], cursor: null, loading: true, error: null });
  const ref = useRef(state);
  ref.current = state;
  const load = useRef(loader);
  load.current = loader;
  const identify = useRef(identity);
  identify.current = identity;
  const control = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const seen = useRef(new Set<string>());
  const empty = useRef(0);
  const request = useCallback(async (append: boolean) => {
    if (append && busy.current) return;
    control.current?.abort();
    const controller = new AbortController();
    control.current = controller;
    busy.current = true;
    const previous = append ? ref.current.items : [];
    const cursor = append ? ref.current.cursor : null;
    if (!append) {
      seen.current.clear();
      empty.current = 0;
    }
    setState({ items: previous, cursor, loading: true, error: null });
    try {
      const page = await load.current(cursor, controller.signal);
      if (controller.signal.aborted) return;
      const items = [
        ...new Map(
          [...previous, ...page.items].map((t) => [identify.current(t), t]),
        ).values(),
      ];
      empty.current = items.length === previous.length ? empty.current + 1 : 0;
      if (
        page.cursor &&
        (page.cursor === cursor ||
          seen.current.has(page.cursor) ||
          empty.current >= 3)
      )
        throw new ApiError("PAGINATION_STALLED", "Pagination stalled");
      if (cursor) seen.current.add(cursor);
      setState({ items, cursor: page.cursor, loading: false, error: null });
    } catch (e) {
      if (!controller.signal.aborted)
        setState({
          items: previous,
          cursor:
            e instanceof ApiError && e.code === "CURSOR_EXPIRED"
              ? null
              : cursor,
          loading: false,
          error: errorMessage(e),
        });
    } finally {
      if (control.current === controller) busy.current = false;
    }
  }, []);
  useEffect(() => {
    void request(false);
    return () => {
      control.current?.abort();
      busy.current = false;
    };
  }, [key, request]);
  return {
    ...state,
    more: () => {
      void request(true);
    },
    reload: () => {
      void request(false);
    },
    retry: () => {
      void request(!!ref.current.cursor);
    },
  };
}
