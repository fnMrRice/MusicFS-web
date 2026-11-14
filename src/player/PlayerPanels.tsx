import { useEffect, useId, useRef, useState } from "react";
import type { SourceTrack } from "../api/types";
import { useServices, useStore } from "../app/services";
import { Icon, IconButton } from "../components/ui";
import { tr, useLocale } from "../i18n";
import { MediaPanel } from "./MediaPanel";
import { VolumeControl } from "./VolumeControl";

const panels = ["queue", "media"] as const;
type Panel = typeof panels[number];
const names = { queue: "播放队列", media: "歌词" };
const pinKeys = { queue: "queuePinned", media: "lyricsPinned" } as const;
const otherPanel = (panel: Panel) => panel === "queue" ? "media" : "queue";

export function PlayerPanels({ track }: { track: SourceTrack | null }) {
  useLocale();
  const s = useServices();
  const prefs = useStore(s.preferences);
  const queue = useStore(s.queue);
  const [open, setOpen] = useState(() => ({ queue: prefs.queuePinned, media: prefs.lyricsPinned }));
  const lastOpened = useRef<Panel>("queue");
  const id = useId();
  const visible = { queue: open.queue, media: open.media && !!track };

  function toggle(panel: Panel) {
    const other = otherPanel(panel);
    if (!visible[panel]) lastOpened.current = panel;
    setOpen(previous => {
      if (previous[panel]) return { ...previous, [panel]: false };
      return { ...previous, [panel]: true, [other]: previous[other] && (prefs.queuePinned || prefs.lyricsPinned) };
    });
  }

  function togglePin(panel: Panel) {
    const key = pinKeys[panel];
    if (prefs[key] && !prefs[pinKeys[otherPanel(panel)]]) {
      // 取消最后一个固定时，只留下正在操作的临时面板。
      setOpen(previous => ({ ...previous, [otherPanel(panel)]: false }));
    }
    s.preference({ [key]: !prefs[key] });
  }

  const { queue: queueVisible, media: lyricsVisible } = visible;
  useEffect(() => {
    if (!queueVisible && !lyricsVisible) return;
    const temporary = queueVisible && !prefs.queuePinned ? "queue"
      : lyricsVisible && !prefs.lyricsPinned ? "media" : null;
    const close = (panel: Panel) => setOpen(previous => ({ ...previous, [panel]: false }));
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (temporary) return close(temporary);
      if (!queueVisible || !lyricsVisible) return close(queueVisible ? "queue" : "media");
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-panel], [data-player-panel-trigger]") : null;
      const focused = target?.dataset.panel ?? target?.dataset.playerPanelTrigger;
      close(focused === "queue" || focused === "media" ? focused : lastOpened.current);
    };
    const outside = (event: PointerEvent) => {
      if (!temporary || !(event.target instanceof Element)) return;
      if (!event.target.closest(".player-panel, [data-player-panel-trigger]")) close(temporary);
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", outside);
    };
  }, [queueVisible, lyricsVisible, prefs.queuePinned, prefs.lyricsPinned]);

  return (
    <>
      <div className="player-extras">
        {panels.map(panel => {
          const icon = panel === "queue" ? "queue" : "lyrics";
          return (
            <IconButton key={panel} icon={icon} label={tr(names[panel])} className={`${icon}-toggle`}
              aria-expanded={visible[panel]}
              aria-pressed={prefs[pinKeys[panel]] ? visible[panel] : undefined}
              aria-controls={visible[panel] ? `${id}-${panel}` : undefined}
              data-player-panel-trigger={panel} disabled={panel === "media" && !track}
              onClick={() => toggle(panel)} />
          );
        })}
        <VolumeControl />
      </div>
      {(queueVisible || lyricsVisible) && (
        <div className="player-panels">
          {panels.filter(panel => visible[panel]).map(panel => {
            const isQueue = panel === "queue";
            const pinned = prefs[pinKeys[panel]];
            const pinLabel = isQueue
              ? pinned ? "取消固定播放队列" : "固定播放队列"
              : pinned ? "取消固定歌词" : "固定歌词";
            return (
              <div key={panel} className="player-panel" data-panel={panel}
                id={`${id}-${panel}`} role="dialog" aria-label={tr(names[panel])}>
                <div className="section-title">
                  <div className="player-panel-heading">
                    <h2>{tr(names[panel])}</h2>
                    {isQueue && (
                      <button className="shuffle-queue" disabled={queue.items.length < 2} onClick={() => s.shuffleQueue()}>
                        <Icon name="shuffle" size={16} />{tr("打乱队列")}
                      </button>
                    )}
                  </div>
                  <IconButton icon="pin" className={`pin-panel ${isQueue ? "pin-queue" : "pin-lyrics"}`}
                    label={tr(pinLabel)} aria-pressed={pinned} onClick={() => togglePin(panel)} />
                  <IconButton icon="close" label={tr("关闭面板")}
                    onClick={() => setOpen(previous => ({ ...previous, [panel]: false }))} />
                </div>
                {isQueue ? (
                  <>
                    <p className="muted">{tr("当前浏览器会话 · {0} 首", { 0: queue.items.length })}</p>
                    {queue.items.length ? (
                      <ol className="queue-list">
                        {queue.items.map((t, i) => (
                          <li key={`${t.sourceTrackId}:${i}`}>
                            <button className={queue.index === i ? "selected" : ""}
                              aria-current={queue.index === i ? "true" : undefined}
                              onClick={() => s.playQueueIndex(i)}>
                              {t.title || t.displayName}
                            </button>
                          </li>
                        ))}
                      </ol>
                    ) : <p className="muted">{tr("还没有加入曲目")}</p>}
                  </>
                ) : <MediaPanel track={track} />}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
