import { useServices, useStore } from "../../app/services";
import { usePages } from "../../components/query";
import { ApiError } from "../../api/client";
import type { Observation, OnlineInstance, OnlinePlaylist, OnlineTrack } from "../../api/content";
import { ErrorNotice, Sentinel } from "../../components/ui";
import { OnlineTrackTable } from "../OnlineTrackTable";
import { tr } from "../../i18n";
import { withRateLimitRetry } from "../../api/rate-limit";

interface Item { position: number; externalId: string; track: OnlineTrack | null; errorCode: string | null }
interface TrackPage { playlist: OnlinePlaylist; items: Item[]; nextCursor: string | null; complete: boolean }

export function OnlinePlaylistTracks({ source, observation }: { source: OnlineInstance; observation: Observation }) {
  const s = useServices();
  const external = observation.playlist.externalId;
  const { ready, session } = useStore(s.auth);
  const downloadScope = ready && session ? JSON.stringify([
    ready.instanceId, session.user.id, source.instanceId, source.accountId ?? "", external,
  ]) : undefined;
  const instance = source.instanceId;
  const pages = usePages(`online-playlist:${instance}:${external}`, async (cursor, signal) => {
    const query = new URLSearchParams({ limit: "30" });
    if (cursor) query.set("cursor", cursor);
    const page = await withRateLimitRetry(() => s.client.request<TrackPage>(
      `/online-instances/${encodeURIComponent(instance)}/playlists/${encodeURIComponent(external)}/tracks?${query}`, { signal }), signal);
    if (!page || page.playlist?.externalId !== external || !Array.isArray(page.items) ||
        page.items.some((item) => !Number.isInteger(item.position) || typeof item.externalId !== "string" ||
          (item.track !== null && (!item.track || item.track.externalId !== item.externalId || typeof item.track.title !== "string" || !Array.isArray(item.track.artists)))) ||
        (page.nextCursor !== null && typeof page.nextCursor !== "string")) {
      throw new ApiError("INVALID_RESPONSE", "Invalid online playlist page");
    }
    return { items: page.items, cursor: page.nextCursor };
  }, (item) => String(item.position));
  return <>
    <OnlineTrackTable key={downloadScope} source={source} rows={pages.items} downloadScope={downloadScope} observation={observation} />
    <ErrorNotice error={pages.error} retry={pages.retry} />
    {pages.loading && <p className="loading">{tr("正在读取歌单…")}</p>}
    <Sentinel active={!!pages.cursor && !pages.loading && !pages.error} load={pages.more} />
  </>;
}
