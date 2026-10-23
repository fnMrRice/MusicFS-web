import { useServices } from "../../app/services";
import { usePages, useResource } from "../../components/query";
import { ApiError } from "../../api/client";
import type { OnlinePlaylist, OnlineTrack } from "../../api/content";
import { duration, ErrorNotice, Sentinel } from "../../components/ui";
import { OnlineAudioActions } from "../OnlineAudioActions";
import { tr } from "../../i18n";

interface Item { position: number; externalId: string; track: OnlineTrack | null; errorCode: string | null }
interface TrackPage { playlist: OnlinePlaylist; items: Item[]; nextCursor: string | null; complete: boolean }

export function OnlinePlaylistTracks({ instance, external }: { instance: string; external: string }) {
  const s = useServices();
  const sources = useResource(`playlist-capabilities:${instance}`, (signal) => s.content.online(signal));
  const playable = sources.data?.find((source) => source.instanceId === instance)?.capabilities.some((c) => c.name === "stream.resolve" && c.supported);
  const pages = usePages(`online-playlist:${instance}:${external}`, async (cursor, signal) => {
    const query = new URLSearchParams({ limit: "30" });
    if (cursor) query.set("cursor", cursor);
    const page = await s.client.request<TrackPage>(`/online-instances/${encodeURIComponent(instance)}/playlists/${encodeURIComponent(external)}/tracks?${query}`, { signal });
    if (!page || page.playlist?.externalId !== external || !Array.isArray(page.items) ||
        page.items.some((item) => !Number.isInteger(item.position) || typeof item.externalId !== "string" ||
          (item.track !== null && (!item.track || item.track.externalId !== item.externalId || typeof item.track.title !== "string" || !Array.isArray(item.track.artists)))) ||
        (page.nextCursor !== null && typeof page.nextCursor !== "string")) {
      throw new ApiError("INVALID_RESPONSE", "Invalid online playlist page");
    }
    return { items: page.items, cursor: page.nextCursor };
  }, (item) => String(item.position));
  return <>
    <ErrorNotice error={sources.error} retry={sources.reload} />
    <div className="table-wrap"><table className="tracks">
      <thead><tr><th>#</th><th>{tr("曲名")}</th><th>{tr("歌手")}</th><th>{tr("时长")}</th>{playable && <th>{tr("操作")}</th>}</tr></thead>
      <tbody>{pages.items.map((item) => <tr key={item.position}>
        <td>{item.position + 1}</td>
        <td>{item.track?.title ?? tr("内容已失效或不可用")}</td>
        <td>{item.track?.artists.join(" / ") || "—"}</td>
        <td>{duration(item.track?.durationMs ?? null)}</td>
        {playable && <td>{item.track && <OnlineAudioActions instance={instance} external={item.externalId} title={item.track.title} />}</td>}
      </tr>)}</tbody>
    </table></div>
    <ErrorNotice error={pages.error} retry={pages.retry} />
    {pages.loading && <p className="loading">{tr("正在读取歌单…")}</p>}
    <Sentinel active={!!pages.cursor && !pages.loading && !pages.error} load={pages.more} />
  </>;
}
