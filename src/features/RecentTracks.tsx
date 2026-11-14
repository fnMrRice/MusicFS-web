import { useEffect, useState } from "react";
import { useServices } from "../app/services";
import { usePages, useResource } from "../components/query";
import { Empty, ErrorNotice } from "../components/ui";
import { ApiError } from "../api/client";
import { musicTrack, playlistTrack, type MusicTrack } from "../api/music-catalog";
import { tr, useLocale } from "../i18n";
import { TrackTable } from "./TrackTable";

interface RecentEntry { musicTrack: MusicTrack; forcedSourceTrackId: string; recordedAt: string }

export function RecentTracks() {
  useLocale();
  const services = useServices();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("musicfs:history-changed", refresh);
    return () => window.removeEventListener("musicfs:history-changed", refresh);
  }, []);
  const key = "recently-played:" + revision;
  const providers = useResource("providers", (signal) => services.libraryApi.providers(signal));
  const page = usePages<RecentEntry>(key, async (cursor, signal) => {
    const params = new URLSearchParams({limit: "100"});
    if (cursor) params.set("cursor", cursor);
    const result = await services.client.request<{items: RecentEntry[]; nextCursor: string | null}>(`/me/recently-played?${params}`, {signal});
    if (!result || !Array.isArray(result.items) || !result.items.every((entry) => entry && musicTrack(entry.musicTrack) &&
      typeof entry.forcedSourceTrackId === "string" && entry.forcedSourceTrackId && Number.isFinite(Date.parse(entry.recordedAt))) ||
      !(result.nextCursor === null || typeof result.nextCursor === "string")) throw new ApiError("INVALID_RESPONSE", "Invalid listening history");
    return {items: result.items, cursor: result.nextCursor};
  }, (entry) => entry.forcedSourceTrackId);
  const tracks = page.items.map((entry) => ({...playlistTrack(entry.musicTrack, entry.forcedSourceTrackId), playlistEntryId: entry.forcedSourceTrackId}));
  return <section aria-label={tr("最近播放")}>
    <ErrorNotice error={page.error} retry={page.retry} />
    {tracks.length > 0 && <TrackTable tracks={tracks} providers={providers.data ?? []} queryKey={key} complete={!page.loading && !page.error && !page.cursor} />}
    {page.loading && <p className="loading" role="status">{tr("正在加载…")}</p>}
    {!tracks.length && !page.loading && !page.error && <Empty title={tr("暂无播放记录")} icon="clock" />}
    {page.cursor && !page.loading && <button type="button" onClick={page.more}>{tr("加载更多")}</button>}
  </section>;
}
