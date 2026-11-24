import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../api/client";
import type { MusicTrack } from "../api/music-catalog";
import { resolveOnlineAudio } from "../api/online-audio";
import { withRateLimitRetry } from "../api/rate-limit";
import { useServices, useStore } from "../app/services";

export function onlineFavoriteIndex(tracks: MusicTrack[], instance: string | undefined): Map<string, MusicTrack> {
  const index = new Map<string, MusicTrack>();
  if (instance) for (const track of tracks) {
    for (const source of track.sources ?? []) {
      if (source.providerInstanceId === instance) index.set(source.sourceId, track);
    }
  }
  return index;
}

export function useOnlineFavorites(instance: string | undefined) {
  const { favorites, client, auth } = useServices();
  const state = useStore(favorites);
  const user = useStore(auth).session?.user.id;
  const index = useMemo(() => onlineFavoriteIndex(state.items, instance), [state.items, instance]);
  const requests = useRef(new Map<string, AbortController>());
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const active = requests.current;
    setPending([]);
    setError(null);
    if (user && instance) void favorites.load();
    return () => {
      active.forEach(request => request.abort());
      active.clear();
    };
  }, [favorites, instance, user]);

  async function toggle(id: string) {
    if (!instance || !user || !state.loaded || requests.current.has(id)) return;
    const request = new AbortController();
    requests.current.set(id, request);
    setPending([...requests.current.keys()]);
    setError(null);
    try {
      const saved = index.get(id);
      // 已收藏的曲目可以直接使用曲库 ID。首次收藏才向平台请求元数据建档。
      const track = saved ?? await withRateLimitRetry(
        () => resolveOnlineAudio(client, instance, id, request.signal), request.signal);
      if (!request.signal.aborted && auth.value.session?.user.id === user) {
        await favorites.setFavorite(track, !saved);
      }
    } catch (cause) {
      if (!request.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (requests.current.get(id) === request) {
        requests.current.delete(id);
        setPending([...requests.current.keys()]);
      }
    }
  }

  return {
    forTrack(id: string) {
      const saved = index.get(id);
      return {
        active: !!saved,
        disabled: !instance || !user || !state.loaded || state.loading || pending.includes(id) ||
          state.pending.includes("@batch") || (!!saved && state.pending.includes(saved.trackId)),
        toggle: () => void toggle(id),
      };
    },
    error: error ?? (instance && !state.loaded ? state.error : null),
    retry: instance && !state.loaded && state.error ? () => void favorites.load(true) : undefined,
  };
}
