import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { DirectoriesApi, type DirectoryPage } from "../../api/directories";
import { directoryError } from "./errors";

export function useDirectoryListing(api: DirectoriesApi, path: string | null = null) {
  const [page, setPage] = useState<DirectoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const retry = useRef<() => void>(() => {});
  const cursors = useRef(new Set<string>());
  async function browse(path: string | null, append = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const cursor = append ? page?.nextCursor ?? null : null;
    if (!append) { cursors.current.clear(); setPage(null); }
    retry.current = () => { void browse(path, append); };
    setLoading(true);
    setError(null);
    try {
      const result = await api.browse(path, cursor, controller.signal);
      if (controller.signal.aborted) return;
      if (append && page?.revision !== result.revision)
        throw new ApiError("CURSOR_EXPIRED", "Directory listing changed");
      if (result.nextCursor && (result.nextCursor === cursor || cursors.current.has(result.nextCursor)))
        throw new ApiError("PAGINATION_STALLED", "Directory pagination stalled");
      if (cursor) cursors.current.add(cursor);
      setPage({ ...result, items: append
        ? [...new Map([...page!.items, ...result.items].map((item) => [item.path, item])).values()]
        : result.items });
    } catch (e) {
      if (!controller.signal.aborted) {
        const expired = e instanceof ApiError && (e.code === "CURSOR_EXPIRED" || append && e.code === "INVALID_ARGUMENT");
        setError(expired ? "目录列表已变化，请重新读取当前目录。" : directoryError(e));
        if (expired || e instanceof ApiError && e.code === "PAGINATION_STALLED")
          retry.current = () => { void browse(path); };
      }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    void browse(path);
    return () => request.current?.abort();
  }, [api, path]);
  return { page, loading, error, browse, retry: () => retry.current() };
}
