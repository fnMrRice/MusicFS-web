import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CatalogPage, CategoriesApi } from "../../api/categories";
import { CatalogState } from "../../library/catalog-state";

export function useCatalogPages<T>(key: string, api: CategoriesApi,
  load: (cursor: string | null, signal: AbortSignal) => Promise<CatalogPage<T>>, identity: (item: T) => string) {
  const state = useMemo(() => new CatalogState(load, identity, (id) => api.release(id)), [key, api]);
  const snapshot = useSyncExternalStore(state.subscribe, () => state.snapshot);
  useEffect(() => { void state.refresh(); return () => state.dispose(); }, [state]);
  return { ...snapshot, more: state.more, reload: state.refresh, retry: state.retry };
}
