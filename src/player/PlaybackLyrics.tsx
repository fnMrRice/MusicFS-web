import { useLayoutEffect, useRef, useState } from "react";
import { useServices, useStore } from "../app/services";
import { LyricsText } from "../components/LyricsText";
import { tr, useLocale } from "../i18n";
import "./playback-lyrics.css";

const scrollKeys = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);

export function PlaybackLyrics({ text, trackId }: { text: string; trackId: string }) {
  useLocale();
  const services = useServices();
  const player = useStore(services.playerState);
  const viewport = useRef<HTMLDivElement>(null);
  const [currentLine, setCurrentLine] = useState<HTMLSpanElement | null>(null);
  const [following, setFollowing] = useState(true);

  useLayoutEffect(() => {
    const area = viewport.current;
    if (!area || !currentLine || !following) return;
    // 切行和视口尺寸变化才重新居中，只滚动歌词正文。
    const resize = new ResizeObserver(() => {
      const line = currentLine.getBoundingClientRect();
      const top = area.scrollTop + line.top - area.getBoundingClientRect().top + (line.height - area.clientHeight) / 2;
      area.scrollTo({ top });
    });
    resize.observe(area);
    resize.observe(currentLine);
    return () => resize.disconnect();
  }, [currentLine, following]);

  function browseLyrics() {
    const area = viewport.current;
    if (!following || !area || area.scrollHeight <= area.clientHeight) return;
    // 停下正在进行的平滑滚动，交还给滚轮、触屏或键盘。
    area.scrollTo({ top: area.scrollTop, behavior: "instant" });
    setFollowing(false);
  }

  return <div className="playback-lyrics">
    <div className="lyrics-viewport" ref={viewport} role="region" aria-label={tr("歌词正文")} tabIndex={0}
      onWheel={event => { if (event.deltaY && !event.ctrlKey) browseLyrics(); }}
      onTouchMove={browseLyrics}
      onKeyDown={event => { if (scrollKeys.has(event.key)) browseLyrics(); }}
      onPointerDown={event => {
        const area = event.currentTarget;
        const right = area.getBoundingClientRect().left + area.clientLeft + area.clientWidth;
        if (event.button === 1 || event.clientX >= right) browseLyrics();
      }}>
      <LyricsText text={text} positionMs={player.track?.sourceTrackId === trackId ? player.positionMs : 0}
        className="lyrics" onCurrentLineChange={setCurrentLine} />
    </div>
    {!following && currentLine && <button className="lyrics-return" onClick={() => {
      viewport.current?.focus({ preventScroll: true });
      setFollowing(true);
    }}>{tr("回到当前歌词")}</button>}
  </div>;
}
