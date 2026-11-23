import type { LocalDSPEngine } from './dsp/engine';

export type MediaEvent =
  | "loadedmetadata"
  | "playing"
  | "pause"
  | "waiting"
  | "stalled"
  | "seeking"
  | "seeked"
  | "timeupdate"
  | "ended"
  | "error";
export interface MediaObservation {
  type: MediaEvent;
  seconds: number;
  paused: boolean;
  readyToPlay?: boolean;
  errorCode?: number;
}
export interface AudioPort {
  play(): Promise<void>;
  pause(): void;
  destroy(): void;
  seek(seconds: number): void;
  setVolume?(volume: number): void;
  fadeOut?(durationMs: number): Promise<void>;
  fadeIn?(durationMs: number, fromCurrent?: boolean): void;
  cancelFade?(): void;
  readonly seconds: number;
  readonly ended?: boolean;
  readonly seekable: { start: number; end: number }[];
}
export type AudioFactory = (
  url: string,
  observe: (event: MediaObservation) => void,
  channels?: number,
) => AudioPort;

export function audioFactory(root: HTMLElement, dsp?: LocalDSPEngine): AudioFactory {
  return (url, observe, channels) => {
    const audio = document.createElement("audio");
    audio.controls = false;
    audio.preload = "metadata";
    audio.setAttribute("aria-label", "当前输出音频");
    const cleanup = new AbortController();
    let fadeInDuration = 0;
    const events: MediaEvent[] = [
      "loadedmetadata",
      "playing",
      "pause",
      "waiting",
      "stalled",
      "seeking",
      "seeked",
      "timeupdate",
      "ended",
      "error",
    ];
    for (const type of events)
      audio.addEventListener(
        type,
        () => {
          if ((type === "ended" && !audio.ended) || (type === "pause" && !audio.paused)) return;
          const readyToPlay = !audio.paused && !audio.seeking && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
          if (type === "pause" || type === "ended") { fadeInDuration = 0; processing?.pause(); }
          if (type === "seeking") processing?.reset(fadeInDuration > 0);
          // 本地定位可能始终有足够缓冲，此时 seeked 后不一定再收到 playing。
          if (fadeInDuration && !audio.paused && !audio.seeking &&
              (type === "playing" || (type === "seeked" && readyToPlay))) {
            processing?.fadeIn(fadeInDuration);
            fadeInDuration = 0;
          }
          if (type === "playing") {
            void processing?.resume().catch(() => audio.pause());
          }
          observe({
            type,
            seconds: audio.currentTime,
            paused: audio.paused,
            readyToPlay,
            errorCode: audio.error?.code,
          });
        },
        { signal: cleanup.signal },
      );
    const processing = dsp?.attach(audio, channels);
    let destroyed = false;
    audio.src = url;
    root.replaceChildren(audio);
    audio.load();
    return {
      play: async () => {
        if (destroyed) throw new DOMException('Audio has been detached', 'AbortError');
        // 两个启动操作都在用户手势的同步调用栈内触发。
        const playing = audio.play();
        const resumed = processing?.resume();
        try {
          await Promise.all([playing, resumed]);
        } catch (error) {
          processing?.pause();
          if (!destroyed) audio.pause();
          throw error;
        }
      },
      pause: () => { fadeInDuration = 0; processing?.pause(); audio.pause(); },
      fadeOut: (durationMs) => {
        fadeInDuration = 0;
        return processing?.fadeOut(durationMs) ?? Promise.resolve();
      },
      fadeIn: (durationMs, fromCurrent = false) => {
        if (fromCurrent && !audio.paused) {
          fadeInDuration = 0;
          processing?.fadeIn(durationMs, true);
        } else {
          fadeInDuration = durationMs;
          processing?.prepareFadeIn();
        }
      },
      cancelFade: () => { fadeInDuration = 0; processing?.fadeIn(0); },
      seek: (seconds) => {
        audio.currentTime = seconds;
      },
      setVolume: (volume) => {
        if (processing) processing.setVolume(volume);
        else audio.volume = volume;
      },
      get seconds() {
        return audio.currentTime;
      },
      get ended() { return audio.ended; },
      get seekable() {
        return Array.from({ length: audio.seekable.length }, (_, index) => ({
          start: audio.seekable.start(index),
          end: audio.seekable.end(index),
        }));
      },
      destroy() {
        destroyed = true;
        cleanup.abort();
        audio.pause();
        processing?.detach();
        audio.removeAttribute("src");
        audio.load();
        audio.remove();
      },
    };
  };
}
