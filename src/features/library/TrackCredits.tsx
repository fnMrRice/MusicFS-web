import { Fragment } from "react";
import { Link } from "react-router-dom";
import type { CatalogAlbum, CatalogArtist, TrackItem } from "../../api/music-catalog";

type Credit = CatalogArtist | CatalogAlbum;

function CreditCell({ credits, provider, label }: { credits?: Credit[]; provider?: string; label?: string | null }) {
  if (provider === undefined || !credits?.length) {
    return <td>{label || credits?.map(credit => credit.name).join(" / ") || "—"}</td>;
  }
  return <td><span className="track-credits">{credits.map((credit, index) => {
    const artist = "artistId" in credit;
    const id = artist ? credit.artistId : credit.albumId;
    const params = new URLSearchParams({ category: artist ? "歌手" : "专辑", categoryId: id });
    if (provider !== "all") params.set("source", provider);
    return <Fragment key={id}>
      {index > 0 && " / "}
      <Link to={{ pathname: "/library", search: params.toString() }}>{credit.name}</Link>
    </Fragment>;
  })}</span></td>;
}

export function TrackCredits({ track, libraryProvider }: { track: TrackItem; libraryProvider?: string }) {
  const catalog = "trackId" in track;
  return <>
    <CreditCell credits={catalog ? track.artists : track.catalogArtists} provider={libraryProvider}
      label={catalog ? undefined : track.artists?.join(" / ")} />
    <CreditCell credits={track.albums} provider={libraryProvider} label={catalog ? undefined : track.album} />
  </>;
}
