import { useId, useState } from "react";
import type { MusicAlbum } from "../../api/music-catalog";
import type { SavedScrapedField, ScrapedItem } from "../../api/scrapers";
import { duration, Icon } from "../../components/ui";
import { tr, useLocale, type Locale } from "../../i18n";
import { AlbumCover } from "../library/AlbumCover";
import { externalLink } from "./fields";

export function genreName(value?: string) {
  if (!value) return undefined;
  const labels: Record<string, string> = { mandopop: "华语流行", cantopop: "粤语流行" };
  return labels[value.toLowerCase()] ? tr(labels[value.toLowerCase()]!) : value;
}

export function albumDate(value: string | null | undefined, locale: Locale) {
  if (!value) return undefined;
  if (/^\d{4}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric",
    ...(/^\d{4}-\d{2}$/.test(value) ? {} : { day: "numeric" as const }), timeZone: "UTC" }).format(date);
}

function MetadataFields({ album, item }: { album: MusicAlbum; item?: ScrapedItem }) {
  const { locale } = useLocale();
  const values = [
    ["显示名", album.name],
    ["原名", album.originalName],
    ["艺人", item?.artist],
    ["发行日期", albumDate(album.releaseDate || item?.date, locale)],
    ["发行商", album.publisher || item?.publisher],
    ["音乐风格", genreName(item?.genre)],
    ["补充信息", item?.description],
  ].filter((entry) => entry[1]);
  return <dl className="album-metadata-fields">{values.map(([label, value]) =>
    <div key={label} className={label === "补充信息" ? "album-metadata-wide" : undefined}>
      <dt>{tr(label!)}</dt><dd>{value}</dd>
    </div>)}</dl>;
}

export function AlbumMetadata({ album, fields, collapsibleTrackList = false }: {
  album: MusicAlbum; fields: SavedScrapedField[]; collapsibleTrackList?: boolean;
}) {
  useLocale();
  const trackListId = useId();
  const [expanded, setExpanded] = useState(false);
  const showTracks = !collapsibleTrackList || expanded;
  const details = fields.find((entry) => entry.field === "albumDetails");
  return <>
    <article className="album-metadata-section">
      <header><h3>{tr("专辑资料")}</h3><div className="album-platform-links">{album.sourceLinks.map(link =>
        <PlatformLink key={link.pluginId} value={link.url} showHost />)}</div></header>
      <MetadataFields album={album} item={details?.item} />
      {!fields.length && <p className="muted album-metadata-empty">{tr("尚无在线专辑资料，可通过「搜索」补充。")}</p>}
    </article>
    {fields.filter((entry) => entry.field !== "albumDetails").map(({ field, item }) => {
    const heading = field === "albumTracks" ? "曲目表" : "封面";
    return <article className="album-metadata-section" key={field}>
      <header><h3>{field === "albumTracks" && collapsibleTrackList && item.tracks?.length
        ? <button type="button" className="album-tracklist-toggle" aria-expanded={expanded} aria-controls={trackListId}
            onClick={() => setExpanded(open => !open)}><Icon name="chevron" size={14} />{tr(heading)}</button>
        : tr(heading)}</h3>
        <PlatformLink value={item.sourceUrl} />
      </header>
      {field === "artwork" && <AlbumCover coverPath={item.imageUrl} name={album.name} size="preview" />}
      {field === "albumTracks" && !!item.tracks?.length && <div id={trackListId} className="album-tracklist-wrap" hidden={!showTracks}>
        {showTracks && <table className="album-tracklist">
          <caption className="sr-only">{tr("专辑曲目")}</caption>
          <thead><tr><th>{tr("曲序")}</th><th>{tr("曲名")}</th><th>{tr("艺人")}</th><th>{tr("时长")}</th></tr></thead>
          <tbody>{item.tracks.map((track, index) => <tr key={index}>
            <td>{track.disc ? `${track.disc}.${track.number || index + 1}` : track.number || index + 1}</td>
            <td>{track.title}</td><td>{track.artist || "—"}</td>
            <td>{track.duration ? duration(track.duration * 1000) : "—"}</td>
          </tr>)}</tbody>
        </table>}
      </div>}
    </article>;
  })}</>;
}

function PlatformLink({ value, showHost }: { value?: string; showHost?: boolean }) {
  const source = externalLink(value);
  return source ? <a href={source} target="_blank" rel="noreferrer" title={new URL(source).hostname}>
    {showHost ? new URL(source).hostname : tr("在平台查看")} <span aria-hidden="true">↗</span>
  </a> : null;
}
