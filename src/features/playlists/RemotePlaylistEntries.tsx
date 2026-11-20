import { ApiError } from "../../api/client";
import type { OnlineTrack, PlaylistEntry, SourceRef } from "../../api/content";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { duration, ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";

interface DisplayItem {
  source: SourceRef;
  remoteTrack: OnlineTrack | null;
  errorCode: string | null;
}
export function RemotePlaylistEntries({ entries }: { entries: PlaylistEntry[] }) {
  const batches = [];
  for (let index = 0; index < entries.length; index += 50) batches.push(entries.slice(index, index + 50));
  return <div className="table-wrap"><table className="tracks">
    <thead><tr><th>{tr("曲名")}</th><th>{tr("歌手")}</th><th>{tr("时长")}</th></tr></thead>
    <tbody>{batches.map((batch) => <Batch key={batch[0].entryId} entries={batch} />)}</tbody>
  </table></div>;
}
function Batch({ entries }: { entries: PlaylistEntry[] }) {
  const s = useServices();
  const sources = entries.map(({ source }) => ({ sourceTrackId: null, remoteSourceId: source.remoteSourceId }));
  const query = useResource(JSON.stringify(sources), async (signal) => {
    const result = await s.client.request<{ items: DisplayItem[] }>("/source-refs/lookup", {
      method: "POST", body: { sources }, signal,
    });
    if (!Array.isArray(result?.items) || result.items.length !== sources.length || result.items.some((item, i) =>
      item?.source?.remoteSourceId !== sources[i].remoteSourceId ||
      (item.remoteTrack !== null && (typeof item.remoteTrack?.title !== "string" || !Array.isArray(item.remoteTrack.artists)))))
      throw new ApiError("INVALID_RESPONSE", "Invalid playlist track metadata");
    return result.items;
  });
  if (query.error) return <tr><td colSpan={3}><ErrorNotice error={query.error} retry={query.reload} /></td></tr>;
  if (!query.data) return <tr><td colSpan={3}>{tr("正在读取…")}</td></tr>;
  return query.data.map(({ remoteTrack, errorCode }, i) => <tr key={entries[i].entryId}>
    <td>{remoteTrack?.title ?? tr("内容已失效或不可用")}{errorCode && `（${errorCode}）`}</td>
    <td>{remoteTrack?.artists.join(" / ") || "—"}</td><td>{duration(remoteTrack?.durationMs ?? null)}</td>
  </tr>);
}
