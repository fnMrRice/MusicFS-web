import { memo, useMemo, useState } from "react";
import { currentLyricTime, parseLyrics } from "./lyrics";
import "./lyrics-text.css";

interface LyricsProps {
  text: string;
  className: string;
  positionMs?: number;
  onCurrentLineChange?: (line: HTMLSpanElement | null) => void;
}

function CreditImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : <img className="lyric-credit-image" src={src} alt="" loading="lazy"
    referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

const LyricsLines = memo(function LyricsLines({ lyrics, current, preview, onCurrentLineChange }: {
  lyrics: ReturnType<typeof parseLyrics>;
  current?: number;
  preview: boolean;
  onCurrentLineChange?: LyricsProps["onCurrentLineChange"];
}) {
  const firstCurrent = current === undefined ? -1 : lyrics.lines.findIndex(line => line.times.includes(current));
  return lyrics.lines.map((line, index) => {
    if (!preview && line === lyrics.offsetLine) return null;
    const active = current !== undefined && line.times.includes(current);
    return <span key={index} className="lyric-line" aria-current={active ? "time" : undefined}
      ref={index === firstCurrent ? onCurrentLineChange : undefined}>
      {line.credits ? line.credits.map((part, i) => {
        const content = <>{part.image && <CreditImage key={part.image} src={part.image} />}{part.text}</>;
        return part.href ? <a className="lyric-credit-link" key={i} href={part.href} target="_blank"
          rel="noreferrer">{content}</a> : <span key={i}>{content}</span>;
      }) : preview ? line.source : line.text}
    </span>;
  });
});

export function LyricsText({ text, className, positionMs, onCurrentLineChange }: LyricsProps) {
  const lyrics = useMemo(() => parseLyrics(text), [text]);
  const current = positionMs === undefined ? undefined : currentLyricTime(lyrics.times, positionMs + lyrics.offset);
  return <pre className={className}>{lyrics.times.length
    ? <LyricsLines lyrics={lyrics} current={current} preview={positionMs === undefined} onCurrentLineChange={onCurrentLineChange} />
    : text}</pre>;
}
