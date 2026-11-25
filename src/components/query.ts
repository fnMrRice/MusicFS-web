import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, errorMessage } from "../api/client";
import { CursorPages } from "../api/cursor-pages";
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
  const load = useRef(loader);
  load.current = loader;
  const identify = useRef(identity);
  identify.current = identity;
  const control = useRef<AbortController | null>(null);
  const pages = useRef<CursorPages<T> | null>(null);
  const request = useCallback(async (append: boolean) => {
    if (append && (control.current || !ref.current.cursor)) return;
    control.current?.abort();
    const controller = new AbortController();
    control.current = controller;
    const previous = append ? ref.current.items : [];
    const cursor = append ? ref.current.cursor : null;
    if (!append) pages.current = null;
    function update(next: typeof state) {
      ref.current = next;
      setState(next);
    }
    update({ items: previous, cursor, loading: true, error: null });
    try {
      const page = await load.current(cursor, controller.signal);
      if (controller.signal.aborted) return;
      const index = pages.current ?? new CursorPages(identify.current);
      const items = index.merge(page.items, cursor, page.cursor);
      pages.current = page.cursor ? index : null;
      update({ items, cursor: page.cursor, loading: false, error: null });
    } catch (e) {
      if (controller.signal.aborted) return;
      const expired = e instanceof ApiError && e.code === "CURSOR_EXPIRED";
      if (expired) pages.current = null;
      update({ items: previous, cursor: expired ? null : cursor, loading: false, error: errorMessage(e) });
    } finally {
      if (control.current === controller) control.current = null;
    }
  }, []);
  useEffect(() => {
    void request(false);
    return () => {
      control.current?.abort();
      control.current = null;
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
