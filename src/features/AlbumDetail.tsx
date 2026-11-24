import { tr, useLocale } from "../i18n";
import { useParams } from "react-router-dom";
import { useServices } from "../app/services";
import { useResource } from "../components/query";
import { sourceAlbumTracks } from "../api/source-album-tracks";
import { Cover, Empty, ErrorNotice } from "../components/ui";
import { TrackTable } from "./TrackTable";
import { useSourceName } from "../components/use-source-name";
export function AlbumDetail() {
  useLocale();
  const { id = "" } = useParams();
  const s = useServices();
  const sourceName = useSourceName();
  const detail = useResource(id, async signal => {
    const album = await s.content.album(id, { signal });
    const tracks = await sourceAlbumTracks(s.libraryApi, album, signal);
    return { album, tracks };
  });
  const { album, tracks = [] } = detail.data ?? {};
  return (
    <section>
      <ErrorNotice error={detail.error} retry={detail.reload} />
      {album && tracks.length > 0 && (
        <div className="detail-heading">
          <Cover large objectId={album.coverObjectId} />
          <div>
            <p className="eyebrow">{tr("来源专辑")}</p>
            <h2>{album.name}</h2>
            <p className="muted">
              {sourceName(album.providerInstanceId)} ·{" "}
              {tr("{0} 首", { 0: tracks.length })}
            </p>
          </div>
        </div>
      )}
      {detail.loading ? (
        <p className="loading">{tr("正在读取专辑…")}</p>
      ) : tracks.length ? (
        <TrackTable tracks={tracks} queryKey={id} complete />
      ) : (
        <Empty title={tr("暂无可读取的曲目")} />
      )}
    </section>
  );
}
