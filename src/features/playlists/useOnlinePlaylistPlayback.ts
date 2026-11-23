import { useEffect } from "react";
import type { Observation, OnlineInstance } from "../../api/content";
import { useServices, useStore } from "../../app/services";
import { supportsOnlinePlayback } from "../../player/online-playlist-playback";

export function useOnlinePlaylistPlayback(source: OnlineInstance, observation: Observation | null) {
  const { onlinePlaylistPlayback: playback } = useServices();
  const preparation = useStore(playback);
  const key = JSON.stringify([source.instanceId, source.accountId, source.accountRevision,
    observation?.playlist.externalId, observation?.observedAt]);
  const canPlay = !!observation?.complete && observation.entries.length > 0 && supportsOnlinePlayback(source);

  useEffect(() => () => playback.leave(key), [playback, key]);
  return {
    canPlay,
    busy: preparation.key === key && preparation.busy,
    error: preparation.key === key ? preparation.error : null,
    play: () => { if (canPlay) void playback.start(key, source, observation.entries); },
    cancel: () => { if (playback.value.key === key) playback.cancel(); },
  };
}
