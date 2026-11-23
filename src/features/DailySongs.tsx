import { dailySongs } from "../api/daily-songs";
import type { OnlineInstance } from "../api/content";
import { useServices } from "../app/services";
import { useResource } from "../components/query";
import { ErrorNotice, IconButton } from "../components/ui";
import { useSourceName } from "../components/use-source-name";
import { tr } from "../i18n";
import { OnlineTrackTable } from "./OnlineTrackTable";

export function DailySongs({ source }: { source: OnlineInstance }) {
  const { client } = useServices();
  const sourceName = useSourceName();
  const songs = useResource(`daily-songs:${source.instanceId}`, (signal) => dailySongs(client, source.instanceId, signal));
  const heading = tr("{0}的每日推荐歌曲", { 0: sourceName(source) });
  return <section className="source-section" aria-label={heading}>
    <div className="section-title">
      <h2>{heading}</h2>
      <IconButton icon="refresh" label={tr("刷新每日推荐歌曲")} disabled={songs.loading} onClick={songs.reload} />
    </div>
    <ErrorNotice error={songs.error} retry={songs.reload} />
    {songs.loading && <p className="loading" role="status">{tr("正在读取曲目…")}</p>}
    {songs.data && (songs.data.length
      ? <OnlineTrackTable source={source} rows={songs.data.map((track, position) => ({ position, track }))} />
      : <p className="muted">{tr("此账号今天暂无推荐歌曲。")}</p>)}
  </section>;
}
