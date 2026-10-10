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
  errorCode?: number;
}
export interface AudioPort {
  play(): Promise<void>;
  pause(): void;
  destroy(): void;
  seek(seconds: number): void;
  setVolume?(volume: number): void;
  readonly seconds: number;
  readonly seekable: { start: number; end: number }[];
}
export type AudioFactory = (
  url: string,
  observe: (event: MediaObservation) => void,
) => AudioPort;

export function audioFactory(root: HTMLElement): AudioFactory {
  return (url, observe) => {
    const audio = document.createElement("audio");
    audio.controls = false;
    audio.preload = "metadata";
    audio.setAttribute("aria-label", "当前输出音频");
    const cleanup = new AbortController();
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
        () =>
          observe({
            type,
            seconds: audio.currentTime,
            paused: audio.paused,
            errorCode: audio.error?.code,
          }),
        { signal: cleanup.signal },
      );
    audio.src = url;
    root.replaceChildren(audio);
    audio.load();
    return {
      play: () => audio.play(),
      pause: () => audio.pause(),
      seek: (seconds) => {
        audio.currentTime = seconds;
      },
      setVolume: (volume) => {
        audio.volume = volume;
      },
      get seconds() {
        return audio.currentTime;
      },
      get seekable() {
        return Array.from({ length: audio.seekable.length }, (_, index) => ({
          start: audio.seekable.start(index),
          end: audio.seekable.end(index),
        }));
      },
      destroy() {
        cleanup.abort();
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        audio.remove();
      },
    };
  };
}
