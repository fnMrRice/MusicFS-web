import { useId, useState } from "react";
import type { MusicAlbum, MusicCategoryKind, MusicTrackQuery } from "../../api/music-catalog";
import type { Provider } from "../../api/types";
import { useServices } from "../../app/services";
import { usePages, useResource } from "../../components/query";
import { Empty, ErrorNotice, Icon, Sentinel } from "../../components/ui";
import { tr } from "../../i18n";
import { TrackTable } from "../TrackTable";
import { AlbumScraping } from "../scrapers/AlbumScraping";
import { AlbumCover } from "./AlbumCover";
import { AlbumCollection } from "./AlbumCollection";
import { ArtistNames, readNamedArtist, type NamedArtist } from "./ArtistNames";

const labels = { artist: "歌手", album: "专辑", genre: "流派" };
const unknownLabels = { artist: "未知歌手", album: "未知专辑", genre: "未知流派" };
type Props = { kind: MusicCategoryKind; provider: string; providers: Provider[]; id: string;
  unknown: boolean; query: string; navigate: (id: string | null) => void };

export function MusicCategoryBrowser(props: Props) {
  return props.id || props.unknown ? <MusicCategoryTracks {...props} /> : <MusicCategoryList {...props} />;
}

function MusicCategoryList({ kind, provider, query, navigate }: Props) {
  const api = useServices().musicCatalog;
  const pages = usePages(`${kind}:${provider}:${query}`, (after, signal) => api.categories(kind, provider, query, after, signal), (item) => item.id);
  return <>
    {kind === "album" ? <AlbumCollection items={pages.items} provider={provider} openAlbum={navigate} /> : <div className="category-cards">
      {pages.items.map((item) => <button type="button" key={item.id} className="category-card" onClick={() => navigate(item.id)}>
        <span className="category-icon"><Icon name={kind === "artist" ? "user" : "music"} size={25} /></span>
        <span className="category-card-text"><strong>{item.name || tr(unknownLabels[kind])}</strong>
          <small>{tr("{0} 首", { 0: item.trackCount })}</small></span>
        <Icon name="chevron" size={16} />
      </button>)}
    </div>}
    <ErrorNotice error={pages.error} retry={pages.retry} />
    {pages.loading && <p className="loading" role="status">{tr("正在加载…")}</p>}
    {!pages.loading && !pages.error && !pages.items.length && <Empty title={tr("暂无可浏览的分类")} />}
    <Sentinel active={!!pages.cursor && !pages.loading && !pages.error} load={pages.more} />
  </>;
}

function MusicCategoryTracks({ kind, provider, providers, id, unknown, query, navigate }: Props) {
  const services = useServices();
  const api = services.musicCatalog;
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const scope = `${kind}:${provider}:${id}:${unknown}:${query}`;
  const title = useResource<{ name: string; album?: MusicAlbum; artist?: NamedArtist }>(scope, async (signal) => {
    if (unknown) return { name: tr(unknownLabels[kind]) };
    if (kind === "album") {
      const album = await api.album(id, signal);
      return { name: album.name, album };
    }
    if (kind === "artist") {
      const artist = await readNamedArtist(services.client, id, signal);
      return { name: artist.name, artist };
    }
    return { name: await api.categoryName(kind, id, signal) };
  });
  const [revision, setRevision] = useState<number>();
  const filter: MusicTrackQuery = { providerInstanceId: provider, q: query };
  if (unknown) filter.unknown = kind;
  else if (kind === "genre") filter.genre = id;
  else if (kind === "artist") filter.artistId = id;
  else filter.albumId = id;
  const pages = usePages(scope, async (after, signal) => {
    const result = await api.tracks(filter, after, signal);
    if (!signal.aborted) setRevision(result.matchingRevision);
    return { items: result.items, cursor: result.nextAfter };
  }, (item) => item.trackId);
  const album = title.data?.album;
  const finish = () => {
    title.reload(); pages.reload(); services.invalidateLibraries();
  };
  return <>
    <nav className="category-breadcrumbs" aria-label={tr("分类路径")}>
      <button type="button" onClick={() => navigate(null)}>{tr(labels[kind])}</button>
      {title.data && <span><Icon name="chevron" size={14} /><span aria-current="page">{title.data.name}</span></span>}
    </nav>
    <ErrorNotice error={title.error} retry={title.reload} />
    {title.data && <div className={`category-heading${album ? " album-heading" : ""}`}>
      {album && <AlbumCover coverPath={album.coverPath} name={album.name} size="heading" />}
      <div className="category-heading-title"><h2>{title.data.name}</h2>
        {title.data.artist && <ArtistNames artist={title.data.artist} refresh={() => { title.reload(); pages.reload(); services.invalidateLibraries(); }} />}
        {album && <button type="button" className="album-details-toggle" aria-label={tr("专辑详情")}
          aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen((value) => !value)}>
          {tr("详情")}<Icon name="chevron" size={14} />
        </button>}
        {!pages.cursor && !pages.error && !pages.loading && <span className="muted">{tr("{0} 首", { 0: pages.items.length })}</span>}
      </div>
    </div>}
    {album && <AlbumScraping album={album} detailsId={detailsId} detailsOpen={detailsOpen}
      applied={finish} refresh={() => { title.reload(); pages.reload(); }} />}
    {(pages.items.length > 0 || album) && <TrackTable tracks={pages.items} providers={providers} queryKey={scope} libraryProvider={provider}
      hideEmptyTable
      pagination={{ loading: pages.loading, hasMore: !!pages.cursor, error: pages.error, more: pages.more }}
      albumScope={album && { albumId: album.albumId, revision: album.revision, reload: () => { title.reload(); pages.reload(); services.invalidateLibraries(); } }}
      matchingRevision={revision} onMatchingChange={kind === "album" && !unknown && !album ? undefined : pages.reload}
      complete={!pages.cursor && !pages.loading && !pages.error} />}
    <ErrorNotice error={pages.error} retry={pages.retry} />
    {pages.loading && <p className="loading" role="status">{tr("正在加载…")}</p>}
    {!pages.error && !pages.loading && !pages.items.length && <Empty title={tr("没有找到相关曲目")} />}
    <Sentinel active={!!pages.cursor && !pages.loading && !pages.error} load={pages.more} />
  </>;
}
