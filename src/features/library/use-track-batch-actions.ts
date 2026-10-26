import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import { TrackSelectionApi, type TrackSelection } from "../../api/track-selection";
import type { SourceTrack } from "../../api/types";
import { useServices } from "../../app/services";
import { withProviderAvailability } from "../../library/track-availability";

export function useTrackBatchActions(queryKey: string, selection: object, tracks: SourceTrack[],
  feedback: (message: string) => void, reportError: (error: string | null) => void) {
  const services = useServices();
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const currentKey = useRef(queryKey);
  const mounted = useRef(true);
  currentKey.current = queryKey;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    return () => { active.current?.abort(); active.current = null; };
  }, [queryKey, selection]);

  async function execute(run: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const request = new AbortController();
    active.current = request;
    setBusy(true);
    reportError(null);
    try { await run(request.signal); }
    catch (error) { if (!request.signal.aborted) reportError(errorMessage(error)); }
    finally {
      if (active.current === request) { active.current = null; setBusy(false); }
    }
  }
  return {
    busy,
    resolve: (selection: TrackSelection, action: (items: SourceTrack[]) => void) => void execute(async (signal) => {
      const result = await new TrackSelectionApi(services.client).resolve(selection, signal);
      if (signal.aborted) return;
      const providers = new Map(services.libraryApi.providerInstances.value.map((provider) => [provider.id, provider]));
      action(result.items.map((track) => withProviderAvailability(track, providers)));
    }),
    favorite: (selection: TrackSelection, value: boolean) => {
      reportError(null);
      void services.favorites.setBatch(selection, value, tracks).then(() => {
        if (mounted.current && currentKey.current === queryKey) feedback(value ? "已收藏" : "已取消收藏");
      }, (error) => {
        if (mounted.current && currentKey.current === queryKey) reportError(errorMessage(error));
      });
    },
  };
}
