import { tr, useLocale, statusText } from "../i18n";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useServices, useStore } from "../app/services";
import { Cover, Icon, IconButton } from "../components/ui";
import { MediaPanel } from "./MediaPanel";
import { playbackFormat, playbackFormatTitle } from "./format";
import type { PlaybackMode } from "./playback-queue";
import { VolumeControl } from "./VolumeControl";
import { useTrackCover } from "../components/use-track-cover";
import { PlayerTime } from "./PlayerTime";

const playbackModes: { mode: PlaybackMode; icon: string; label: string }[] = [
  { mode: "sequence", icon: "sequence", label: "顺序播放" },
  { mode: "repeat-all", icon: "repeat", label: "列表循环" },
  { mode: "repeat-one", icon: "repeat-one", label: "单曲循环" },
  { mode: "shuffle", icon: "shuffle", label: "随机播放" },
];

export function PlayerBar() {
  useLocale();
  const s = useServices();
  const state = useStore(s.playerState);
  const coverObjectId = useTrackCover(state.track);
  const q = useStore(s.queue);
  const modeIndex = playbackModes.findIndex((option) => option.mode === q.mode);
  const mode = playbackModes[modeIndex];
  const dsp = useStore(s.localDSP);
  const prefs = useStore(s.preferences);
  const [queueOpen, setQueueOpen] = useState(prefs.queuePinned);
  const [lyricsOpen, setLyricsOpen] = useState(prefs.lyricsPinned);
  const [activePanel, setActivePanel] = useState<"queue" | "media">("queue");
  const visiblePanels = { queue: queueOpen, media: lyricsOpen && !!state.track };
  const panel = visiblePanels[activePanel] ? activePanel : visiblePanels.queue ? "queue" : visiblePanels.media ? "media" : null;
  const panelPinned = panel === "queue" ? prefs.queuePinned : prefs.lyricsPinned;
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [seek, setSeek] = useState<number | null>(null);
  const closePanel = () => {
    if (panel === "queue") setQueueOpen(false);
    else setLyricsOpen(false);
  };
  const togglePanel = (next: "queue" | "media") => {
    const open = panel !== next;
    if (next === "queue") {
      setQueueOpen(open);
      if (open && !prefs.lyricsPinned) setLyricsOpen(false);
    } else {
      setLyricsOpen(open);
      if (open && !prefs.queuePinned) setQueueOpen(false);
    }
    if (open) setActivePanel(next);
  };
  useEffect(() => {
    setSeek(null);
  }, [state.track?.sourceTrackId, state.playback?.attemptId]);
  useEffect(() => {
    if (!panel) return;
    const close = () => {
      if (panel === "queue") setQueueOpen(false);
      else setLyricsOpen(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const outside = (event: PointerEvent) => {
      if (panelPinned) return;
      if (!(event.target instanceof Node) || panelRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[data-player-panel-trigger]")) return;
      close();
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", outside);
    };
  }, [panel, panelPinned]);
  const playback = state.playback;
  const range = playback?.seekableRange;
  const timelineStart = range?.startMs ?? 0;
  const timelineEnd = range?.endMs || state.track?.durationMs || 1;
  const timelineStep = 100;
  const timelineSteps = Math.max(0, Math.floor((timelineEnd - timelineStart) / timelineStep));
  // 与原生滑块的步进取整一致，使填色终点始终贴合指示中心。
  const timelinePosition = timelineStart + timelineStep * Math.min(
    timelineSteps,
    Math.max(0, Math.round(((seek ?? state.positionMs) - timelineStart) / timelineStep)),
  );
  const progress = timelineEnd > timelineStart
    ? (timelinePosition - timelineStart) / (timelineEnd - timelineStart)
    : 0;
  const format = state.track ? playbackFormat(state.track, playback) : tr("暂无编码信息");
  const localEffects = dsp.supported && !dsp.error && dsp.config.enabled && dsp.config.chain.some((node) => node.enabled);
  const commit = (value: number) => {
    s.player.seek(value);
    setSeek(null);
  };
  return (
    <section className="player" aria-label={tr("播放器")}>
      <input
        className="timeline"
        style={{ "--timeline-progress": progress } as CSSProperties}
        type="range"
        aria-label={tr("曲目进度")}
        min={timelineStart}
        max={timelineEnd}
        step={timelineStep}
        value={timelinePosition}
        disabled={!range || playback?.seekMode === "none"}
        onChange={(e) => setSeek(Number(e.target.value))}
        onPointerUp={(e) => commit(Number(e.currentTarget.value))}
        onKeyUp={(e) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "Home",
              "End",
              "PageUp",
              "PageDown",
            ].includes(e.key)
          )
            commit(Number(e.currentTarget.value));
        }}
      />
      <div className="now-playing">
        <Cover objectId={coverObjectId} />
        <div>
          <strong>
            {state.track?.title || state.track?.displayName || tr("暂无音频")}
          </strong>
          <small>
            {state.track
              ? state.track.artists?.join(" / ") || tr("未知歌手")
              : tr("暂无作者")}
          </small>
          <small className="player-status" title={state.track ? playbackFormatTitle(state.track, playback) : format}>
            {format}
            {playback && localEffects && ` · ${tr("本地音效")}`}
          </small>
        </div>
      </div>
      <div className="transport">
        <IconButton
          icon={mode.icon}
          label={tr("播放模式：{0}，点击切换", { 0: tr(mode.label) })}
          className={q.mode === "sequence" ? "" : "playback-mode-active"}
          onClick={() => s.setPlaybackMode(playbackModes[(modeIndex + 1) % playbackModes.length].mode)}
        />
        <IconButton
          icon="previous"
          label={tr("上一首")}
          disabled={!s.canNext(-1)}
          onClick={() => s.next(-1)}
        />
        <IconButton
          className="play-main"
          icon={state.wantsPlay ? "pause" : "play"}
          label={state.wantsPlay ? tr("暂停") : tr("播放")}
          disabled={!playback || state.phase === "error"}
          onClick={() => s.player.toggle()}
        />
        <IconButton
          icon="next"
          label={tr("下一首")}
          disabled={!s.canNext(1)}
          onClick={() => s.next(1)}
        />
        <PlayerTime positionMs={seek ?? state.positionMs} durationMs={state.track?.durationMs ?? null} />
      </div>
      <div className="player-extras">
        <IconButton
          icon="queue"
          label={tr("播放队列")}
          className="queue-toggle"
          aria-expanded={panel === "queue"}
          aria-pressed={prefs.queuePinned ? panel === "queue" : undefined}
          aria-controls={panel === "queue" ? panelId : undefined}
          data-player-panel-trigger="queue"
          onClick={() => togglePanel("queue")}
        />
        <IconButton
          icon="lyrics"
          label={tr("歌词")}
          className="lyrics-toggle"
          aria-expanded={panel === "media"}
          aria-pressed={prefs.lyricsPinned ? panel === "media" : undefined}
          aria-controls={panel === "media" ? panelId : undefined}
          data-player-panel-trigger="lyrics"
          disabled={!state.track}
          onClick={() => togglePanel("media")}
        />
        <VolumeControl />
      </div>
      {state.message && (
        <div className="playback-message" role="alert">
          {statusText(state.message)}
          {state.phase === "error" && (
            <button
              onClick={() => {
                if (state.track)
                  void s.player.select(state.track, s.playbackPreferences());
              }}
            >
              {tr("从头播放")}
            </button>
          )}
        </div>
      )}
      {dsp.error && state.track && <div className="playback-message" role="alert">{statusText(dsp.error)}</div>}
      {panel && (
        <div className="player-panel" ref={panelRef} id={panelId} role="dialog"
          aria-label={panel === "queue" ? tr("播放队列") : tr("歌词")}>
          <div className="section-title">
            <div className="player-panel-heading">
              <h2>{panel === "queue" ? tr("播放队列") : tr("歌词")}</h2>
              {panel === "queue" && (
                <button className="shuffle-queue" disabled={q.items.length < 2} onClick={() => s.shuffleQueue()}>
                  <Icon name="shuffle" size={16} />
                  {tr("打乱队列")}
                </button>
              )}
            </div>
            <IconButton
              icon="pin"
              className={`pin-panel ${panel === "queue" ? "pin-queue" : "pin-lyrics"}`}
              label={panel === "queue"
                ? panelPinned ? tr("取消固定播放队列") : tr("固定播放队列")
                : panelPinned ? tr("取消固定歌词") : tr("固定歌词")}
              aria-pressed={panelPinned}
              onClick={() => s.preference(panel === "queue" ? { queuePinned: !panelPinned } : { lyricsPinned: !panelPinned })}
            />
            <IconButton
              icon="close"
              label={tr("关闭面板")}
              onClick={closePanel}
            />
          </div>
          {panel === "queue" ? (
            <>
              <p className="muted">
                {tr("临时播放列表 · {0} 首", { 0: q.items.length })}
              </p>
              {q.items.length ? (
                <ol className="queue-list">
                  {q.items.map((t, i) => (
                    <li key={`${t.sourceTrackId}:${i}`}>
                      <button
                        className={q.index === i ? "selected" : ""}
                        aria-current={q.index === i ? "true" : undefined}
                        onClick={() => s.playQueueIndex(i)}
                      >
                        {t.title || t.displayName}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">{tr("还没有加入曲目")}</p>
              )}
            </>
          ) : (
            <MediaPanel track={state.track} />
          )}
        </div>
      )}
    </section>
  );
}
