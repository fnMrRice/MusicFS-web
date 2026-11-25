import type { ScrapedItem, ScrapedTrack } from "../../api/scrapers";
import { languageLabel } from "../../api/localized-titles";
import { useState } from "react";
import { duration } from "../../components/ui";
import { LyricsText } from "../../components/LyricsText";
import { tr, useLocale } from "../../i18n";
import { externalLink } from "./fields";

export function TrackCredits({ track }: { track: ScrapedTrack }) {
  return <>
    {track.artist && <small>{tr("艺人")} · {track.artist}</small>}
    {track.composer && <small>{tr("作曲")} · {track.composer}</small>}
  </>;
}

export function ScrapedPreview({ item }: { item: ScrapedItem }) {
  const { locale } = useLocale();
  const image = externalLink(item.imageUrl);
  const source = externalLink(item.sourceUrl);
  const [unavailable, setUnavailable] = useState("");
  return <div className="scraped-preview">
    {[{ label: "曲名", names: item.localizedTitles }, { label: "歌手名称", names: item.localizedArtistNames }]
      .map(({ label, names }) => names?.length ? <dl key={label} className="scraped-names">
        {names.map(({ language, title }, index) => <div key={index}>
          <dt>{tr(label)} · {languageLabel(language, locale)}</dt><dd>{title}</dd>
        </div>)}</dl> : null)}
    <div className="scraped-byline">{[item.artist, item.album, item.date, item.duration ? duration(item.duration * 1000) : ""]
      .filter(Boolean).join(" · ")}</div>
    {item.description && <p>{item.description}</p>}
    {image && unavailable !== image && <img className="scraped-image" src={image} alt={item.title}
      loading="lazy" referrerPolicy="no-referrer" onError={() => setUnavailable(image)} />}
    {item.lyrics && <LyricsText className="scraped-lyrics" text={item.lyrics} />}
    {!!item.tracks?.length && <ol className="scraped-track-list" aria-label={tr("专辑曲目")}>
      {item.tracks.map((track, index) => <li key={index}>
        <span>{[track.disc, track.number].filter(Boolean).join(".") || index + 1}</span>
        <span>{track.title}<TrackCredits track={track} /></span>
        {track.duration ? <time>{duration(track.duration * 1000)}</time> : null}
      </li>)}
    </ol>}
    {(image || source) && <div className="scraped-links">
      {image && <a href={image} target="_blank" rel="noreferrer">{tr("查看原图")}</a>}
      {source && <a href={source} target="_blank" rel="noreferrer">{tr("查看来源页面")}</a>}
    </div>}
  </div>;
}
