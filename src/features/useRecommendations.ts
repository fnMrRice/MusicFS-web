import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../api/client";
import type { ContentApi, RecommendationPage, RecommendationRead } from "../api/content";

export function useRecommendations(api: ContentApi) {
  const [latest, setLatest] = useState<RecommendationPage | null>(null);
  const [past, setPast] = useState<{ offset: number; page: RecommendationPage } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const lastRead = useRef<RecommendationRead>("current");

  const load = useCallback(async (read: RecommendationRead) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    lastRead.current = read;
    setLoading(true);
    setError(null);
    try {
      const page = await api.recommendations(read, controller.signal);
      if (controller.signal.aborted) return;
      if (typeof read === "object") setPast({ offset: read.history, page });
      else {
        setLatest(page);
        setPast(null);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setLoading(false);
      }
    }
  }, [api]);

  useEffect(() => {
    void load("current");
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [load]);

  return {
    page: past?.page ?? latest, offset: past?.offset ?? 0, loading, error,
    previous: () => void load({ history: (past?.offset ?? 0) + 1 }),
    refresh: () => void load("refresh"),
    retry: () => void load(lastRead.current),
    showLatest: () => { setPast(null); setError(null); },
  };
}
