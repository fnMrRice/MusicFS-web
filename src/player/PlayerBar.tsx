import { tr, useLocale, statusText } from "../i18n";
import { useEffect, useState, type CSSProperties } from "react";
import { useServices, useStore } from "../app/services";
import { Cover, duration, IconButton } from "../components/ui";
import { MediaPanel } from "./MediaPanel";
import { playbackFormat } from "./format";

export function PlayerBar() {
  useLocale();
  const s = useServices();
  const state = useStore(s.playerState);
  const q = useStore(s.queue);
  const prefs = useStore(s.preferences);
  const dsp = useStore(s.localDSP);
  const [panel, setPanel] = useState<"queue" | "media" | null>(null);
  const [seek, setSeek] = useState<number | null>(null);
  useEffect(() => {
    setSeek(null);
  }, [state.track?.sourceTrackId, state.playback?.attemptId]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);
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
        <Cover />
        <div>
          <strong>
            {state.track?.title || state.track?.displayName || tr("暂无音频")}
          </strong>
          <small>
            {state.track
              ? state.track.artists?.join(" / ") || tr("未知歌手")
              : tr("暂无作者")}
          </small>
          <small className="player-status" title={format}>
            {format}
            {playback && localEffects && ` · ${tr("本地音效")}`}
          </small>
        </div>
      </div>
      <div className="transport">
        <IconButton
          icon="repeat"
          label={q.repeat ? tr("关闭列表循环") : tr("列表循环")}
          aria-pressed={q.repeat}
          onClick={() => s.queue.set({ ...q, repeat: !q.repeat })}
        />
        <IconButton
          icon="previous"
          label={tr("上一首")}
          disabled={!q.items.length || (!q.repeat && q.index <= 0)}
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
          disabled={
            !q.items.length || (!q.repeat && q.index >= q.items.length - 1)
          }
          onClick={() => s.next(1)}
        />
        <span className="time">
          {duration(state.positionMs)}
          <span> / {duration(state.track?.durationMs ?? null)}</span>
        </span>
      </div>
      <div className="player-extras">
        <IconButton
          icon="stop"
          label={tr("停止")}
          disabled={!state.track}
          onClick={() => s.player.stop()}
        />
        <IconButton
          icon="queue"
          label={tr("播放队列")}
          aria-expanded={panel === "queue"}
          onClick={() => setPanel(panel === "queue" ? null : "queue")}
        />
        <IconButton
          icon="lyrics"
          label={tr("歌词与封面")}
          disabled={!state.track}
          onClick={() => setPanel(panel === "media" ? null : "media")}
        />
        <IconButton
          icon="volume"
          label={prefs.volume ? tr("静音") : tr("取消静音")}
          onClick={() => s.preference({ volume: prefs.volume ? 0 : 0.8 })}
        />
        <input
          aria-label={tr("音量")}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={prefs.volume}
          onChange={(e) => s.preference({ volume: Number(e.target.value) })}
        />
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
          <button onClick={() => s.player.stop()}>{tr("停止播放")}</button>
        </div>
      )}
      {dsp.error && state.track && <div className="playback-message" role="alert">{statusText(dsp.error)}</div>}
      {panel && (
        <div className="player-panel">
          <div className="section-title">
            <h2>{panel === "queue" ? tr("播放队列") : tr("歌词与封面")}</h2>
            <IconButton
              icon="close"
              label={tr("关闭面板")}
              onClick={() => setPanel(null)}
            />
          </div>
          {panel === "queue" ? (
            <>
              <p className="muted">
                {tr("当前浏览器会话 · {0} 首", { 0: q.items.length })}
              </p>
              {q.items.length ? (
                <ol className="queue-list">
                  {q.items.map((t, i) => (
                    <li key={`${t.sourceTrackId}:${i}`}>
                      <button
                        className={q.index === i ? "selected" : ""}
                        onClick={() => {
                          s.queue.set({ ...q, index: i });
                          void s.player.select(t, s.playbackPreferences());
                        }}
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
