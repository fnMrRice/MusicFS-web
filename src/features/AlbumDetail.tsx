import { useParams } from "react-router-dom";
import { useServices } from "../app/services";
import { useResource } from "../components/query";
import { useCatalog } from "./catalog";
import { Cover, Empty, ErrorNotice } from "../components/ui";
import { TrackTable } from "./TrackTable";
export function AlbumDetail() {
  const { id = "" } = useParams();
  const s = useServices();
  const album = useResource(id, (signal) => s.content.album(id, { signal }));
  const catalog = useCatalog();
  const tracks =
    album.data?.sourceTrackIds.flatMap((id) => {
      const t = catalog.data?.find((t) => t.sourceTrackId === id);
      return t ? [t] : [];
    }) ?? [];
  return (
    <section>
      <ErrorNotice error={album.error} retry={album.reload} />
      <ErrorNotice error={catalog.error} retry={catalog.reload} />
      {album.data && (
        <div className="detail-heading">
          <Cover large />
          <div>
            <p className="eyebrow">来源专辑</p>
            <h2>{album.data.name}</h2>
            <p className="muted">
              {album.data.providerInstanceId} ·{" "}
              {album.data.sourceTrackIds.length} 首
            </p>
          </div>
        </div>
      )}
      {album.loading || catalog.loading ? (
        <p className="loading">正在读取专辑…</p>
      ) : tracks.length ? (
        <TrackTable
          tracks={tracks}
          queryKey={id}
          complete={
            !album.error &&
            !catalog.error &&
            tracks.length === album.data?.sourceTrackIds.length
          }
        />
      ) : (
        <Empty title="暂无可读取的曲目" />
      )}
    </section>
  );
}
