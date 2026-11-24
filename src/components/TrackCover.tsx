import type { SourceTrack } from "../api/types";
import { Cover } from "./ui";
import { useTrackCover } from "./use-track-cover";

export function TrackCover({ track }: { track: SourceTrack | null }) {
  return <Cover src={useTrackCover(track) ?? undefined} />;
}
