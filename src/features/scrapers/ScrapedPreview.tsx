import type { ScrapedItem } from "../../api/scrapers";
import { useState } from "react";
import { duration } from "../../components/ui";
import { tr } from "../../i18n";
import { externalLink } from "./fields";

export function ScrapedPreview({ item }: { item: ScrapedItem }) {
  const image = externalLink(item.imageUrl);
  const source = externalLink(item.sourceUrl);
  const [unavailable, setUnavailable] = useState("");
  return <div className="scraped-preview">
    <div className="scraped-byline">{[item.artist, item.album, item.date, item.duration ? duration(item.duration * 1000) : ""]
      .filter(Boolean).join(" · ")}</div>
    {item.description && <p>{item.description}</p>}
    {image && unavailable !== image && <img className="scraped-image" src={image} alt={item.title}
      loading="lazy" referrerPolicy="no-referrer" onError={() => setUnavailable(image)} />}
    {item.lyrics && <pre className="scraped-lyrics">{item.lyrics}</pre>}
    {!!item.tracks?.length && <ol className="scraped-track-list" aria-label={tr("专辑曲目")}>
      {item.tracks.map((track, index) => <li key={index}>
        <span>{[track.disc, track.number].filter(Boolean).join(".") || index + 1}</span>
        <span>{track.title}{track.artist && <small>{track.artist}</small>}</span>
        {track.duration ? <time>{duration(track.duration * 1000)}</time> : null}
      </li>)}
    </ol>}
    {(image || source) && <div className="scraped-links">
      {image && <a href={image} target="_blank" rel="noreferrer">{tr("查看原图")}</a>}
      {source && <a href={source} target="_blank" rel="noreferrer">{tr("查看来源页面")}</a>}
    </div>}
  </div>;
}
