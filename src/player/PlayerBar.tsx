import { tr, useLocale, statusText } from "../i18n";
import { useEffect, useState } from "react";
import { useServices, useStore } from "../app/services";
import { Cover, duration, IconButton } from "../components/ui";
import { MediaPanel } from "./MediaPanel";

const phase: Record<string, string> = {
  idle: "选择一首曲目，开始聆听",
  resolving: "正在准备播放…",
  loading: "正在加载…",
  playing: "正在播放",
  paused: "已暂停",
  buffering: "正在缓冲…",
  seeking: "正在定位…",
  recovering: "正在恢复…",
  ended: "播放结束",
  error: "播放失败",
};
export function PlayerBar() {
  useLocale();
  const s = useServices();
  const state = useStore(s.playerState);
  const q = useStore(s.queue);
  const prefs = useStore(s.preferences);
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
  const decrypted = playback?.effectiveProcessing.some(
    (p) =>
      !!p && typeof p === "object" && "type" in p && p.type === "ncmDecrypt",
  );
  const output = decrypted
    ? playback?.deliveryMode === "processed"
      ? "服务端解密并转码输出"
      : "服务端解密输出"
    : playback?.deliveryMode === "processed"
      ? "服务端处理输出"
      : "原流播放";
  const commit = (value: number) => {
    s.player.seek(value);
    setSeek(null);
  };
  return (
    <section className="player" aria-label={tr("播放器")}>
      <input
        className="timeline"
        type="range"
        aria-label={tr("曲目进度")}
        min={range?.startMs ?? 0}
        max={range?.endMs || state.track?.durationMs || 1}
        step={100}
        value={seek ?? state.positionMs}
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
            {state.track?.title || state.track?.displayName || tr("尚未播放")}
          </strong>
          <small>
            {state.track
              ? state.track.artists?.join(" / ") || tr("未知歌手")
              : tr("你的音乐，随时相伴")}
          </small>
          <small className="player-status">
            {tr(phase[state.phase])}
            {playback && ` · ${tr(output)}`}
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
