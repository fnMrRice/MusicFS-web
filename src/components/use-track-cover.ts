import type { SourceTrack } from "../api/types";
import { useServices, useStore } from "../app/services";
import { trackCover } from "../app/recording-covers";

export function useTrackCover(track: SourceTrack | null): string | null | undefined {
  const services = useServices();
  return trackCover(track, useStore(services.recordingCovers));
}
