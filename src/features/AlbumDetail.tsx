import { tr, useLocale } from "../i18n";
import { useParams } from "react-router-dom";
import { useServices } from "../app/services";
import { useResource } from "../components/query";
import { useCatalog } from "./catalog";
import { Cover, Empty, ErrorNotice } from "../components/ui";
import { TrackTable } from "./TrackTable";
import { useSourceName } from "../components/use-source-name";
export function AlbumDetail() {
  useLocale();
  const { id = "" } = useParams();
  const s = useServices();
  const sourceName = useSourceName();
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
      {album.data && !catalog.loading && !catalog.error && tracks.length > 0 && (
        <div className="detail-heading">
          <Cover large />
          <div>
            <p className="eyebrow">{tr("来源专辑")}</p>
            <h2>{album.data.name}</h2>
            <p className="muted">
              {sourceName(album.data.providerInstanceId)} ·{" "}
              {tr("{0} 首", { 0: tracks.length })}
            </p>
          </div>
        </div>
      )}
      {album.loading || catalog.loading ? (
        <p className="loading">{tr("正在读取专辑…")}</p>
      ) : tracks.length ? (
        <TrackTable
          tracks={tracks}
          queryKey={id}
          complete={
            !album.error &&
            !catalog.error
          }
        />
      ) : (
        <Empty title={tr("暂无可读取的曲目")} />
      )}
    </section>
  );
}
