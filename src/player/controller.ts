import type { PlaybackApi } from "../api/playback";
import type {
  Capabilities,
  Playback,
  Preferences,
  SourceTrack,
} from "../api/types";
import type {
  AudioFactory,
  AudioPort,
  MediaObservation,
} from "./audio-adapter";
import { initialState } from "./state";
import { ControlQueue, isUncertain } from "./control-queue";
import { RecoveryBudget } from "./recovery";
import { trackPosition, seekAllowed } from "./timeline";
import { playbackErrorMessage } from "./errors";
import { observeOutputProfile } from "./output-profile";
import { PlaybackTransitions, type FadeSettings } from "./playback-transitions";

export class PlayerController {
  state = initialState();
  onChange: (() => void) | null = null;
  onSelectionCancelled: (() => void) | null = null;
  onPlaybackStarted: ((playback: Playback, signal: AbortSignal) => Promise<void>) | null = null;
  private reportedSession: string | null = null;
  private generation = 0;
  private controller: AbortController | null = null;
  private audio: AudioPort | null = null;
  private queue: ControlQueue | null = null;
  private recovery = new RecoveryBudget();
  private bufferingTimer: ReturnType<typeof setTimeout> | null = null;
  private volume = 0.8;
  private selection = 0;
  private pendingSelection: number | null = null;
  private seekingOut = false;
  private waitingForRange = false;
  private transitions = new PlaybackTransitions();
  setTransitions(settings: FadeSettings): void {
    this.transitions.configure(settings, this.audio);
  }
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.audio?.setVolume?.(this.volume);
  }
  toggle(preferences?: Preferences): void {
    // 刷新后只展示选中曲目，首次手动播放时才解析来源并创建新会话。
    if (this.state.phase === "paused" && this.state.track && !this.controller) {
      void this.select(this.state.track, preferences);
      return;
    }
    if (this.state.wantsPlay) {
      this.state.wantsPlay = false;
      this.transitions.pause(this.audio, this.state.phase === "playing" && !this.seekingOut && this.pendingSelection === null);
      this.clearBufferingTimer();
      this.state.phase = "paused";
      this.emit();
    } else {
      this.unlockAudio();
      this.state.wantsPlay = true;
      const generation = this.generation;
      const audio = this.audio;
      if (this.transitions.resume(audio)) this.state.phase = "playing";
      if (audio)
        void audio.play().catch((error: unknown) => {
          if (generation !== this.generation || this.audio !== audio || !this.state.wantsPlay ||
              (error instanceof DOMException && error.name === "AbortError")) return;
          this.state.wantsPlay = false;
          this.state.phase = "paused";
          this.state.message = "播放未能开始，请再次点击播放。";
          this.emit();
        });
      this.emit();
    }
  }
  constructor(
    private api: Pick<PlaybackApi, "create" | "close" | "control" | "outputProfile">,
    private createAudio: AudioFactory,
    private capabilities: Capabilities,
    private unlockAudio: () => void = () => {},
    private resolveSelection?: (selection: NonNullable<SourceTrack["playbackSelection"]>, signal: AbortSignal) => Promise<SourceTrack>,
  ) {}
  async select(
    track: SourceTrack,
    preferences: Preferences = { forceProcessing: false, gainDb: 0 },
  ): Promise<void> {
    this.unlockAudio();
    const selection = ++this.selection;
    this.seekingOut = false;
    let wantsPlay = true;
    if (this.state.wantsPlay && this.state.phase === "playing") {
      const outgoing = this.transitions.fadeOut("trackMs", this.audio);
      if (outgoing) {
        this.pendingSelection = selection;
        await outgoing;
        if (selection !== this.selection) return;
        this.pendingSelection = null;
        wantsPlay = this.state.wantsPlay || ["ended"].includes(this.state.phase);
      }
    }
    this.stop();
    this.transitions.prepareIncoming("trackMs");
    // 浏览器音效始终由本地执行；旧服务端配置不得叠加到新会话。
    preferences = { ...preferences, gainDb: 0, dspExecution: "client" };
    const generation = this.generation;
    this.state = {
      ...initialState(),
      track,
      phase: "resolving",
      wantsPlay,
    };
    this.emit();
    this.controller = new AbortController();
    this.recovery = new RecoveryBudget();
    try {
      if (track.playbackSelection && this.resolveSelection) {
        track = await this.resolveSelection(track.playbackSelection, this.controller.signal);
        if (generation !== this.generation) return;
        this.state.track = track;
        this.emit();
      }
      const key = crypto.randomUUID();
      let playback: Playback;
      try {
        playback = await this.api.create(
          track.sourceTrackId,
          this.capabilities,
          preferences,
          key,
          this.controller.signal,
          track.playbackSelection,
        );
      } catch (error) {
        if (generation !== this.generation || !isUncertain(error)) throw error;
        playback = await this.api.create(
          track.sourceTrackId,
          this.capabilities,
          preferences,
          key,
          this.controller.signal,
          track.playbackSelection,
        );
      }
      if (generation !== this.generation) {
        void this.api.close(playback.sessionId).catch(() => {});
        return;
      }
      this.queue = new ControlQueue(
        playback,
        (current, intent, key, signal) =>
          this.api.control(
            current.sessionId,
            intent.kind,
            current.attemptId,
            intent.positionMs,
            key,
            intent.observedError,
            signal,
          ),
        (current, apply) => {
          if (generation !== this.generation) return;
          this.state.playback = current;
          if (apply) this.attach(current, generation);
        },
        (error) => {
          if (generation === this.generation) this.fail(playbackErrorMessage(error));
        },
      );
      this.attach(playback, generation);
    } catch (error) {
      if (generation === this.generation) this.fail(playbackErrorMessage(error));
    }
  }
  stop(): void { this.restorePaused(null); }

  restorePaused(track: SourceTrack | null): void {
    ++this.selection;
    this.pendingSelection = null;
    this.seekingOut = false;
    this.transitions.stop();
    ++this.generation;
    this.controller?.abort();
    this.controller = null;
    this.queue?.dispose();
    this.queue = null;
    this.clearBufferingTimer();
    this.audio?.destroy();
    this.audio = null;
    if (this.state.playback)
      void this.api.close(this.state.playback.sessionId).catch(() => {});
    this.state = track ? { ...initialState(), track, phase: "paused" } : initialState();
    this.emit();
  }
  private attach(playback: Playback, generation: number): void {
    this.waitingForRange = false;
    if (playback.dspExecution !== "client" || playback.effectiveProcessing.some((step) =>
      !step || typeof step !== "object" || !("type" in step) ||
      !["ncmDecrypt", "transcode"].includes(String(step.type)))) {
      this.state.playback = playback;
      this.fail("服务端仍在处理音效或输出声道，请更新服务端后重新播放。");
      return;
    }
    if (playback.resumeDecision !== "continue") {
      this.state.playback = playback;
      this.fail(
        playback.resumeDecision === "restartRequired"
          ? "无法确认续播位置，请选择从头播放。"
          : "此来源暂不可播放，请选择其他歌曲。",
      );
      return;
    }
    this.audio?.destroy();
    this.state.playback = playback;
    this.state.phase = "loading";
    this.state.message = null;
    this.state.positionMs = playback.positionOriginMs;
    const refreshProfile = observeOutputProfile(this.api, playback, this.controller?.signal, profile => {
      if (this.state.playback !== playback || !this.audio) return;
      this.state.playback = { ...playback, outputProfile: profile, outputProfilePending: false };
      this.audio.setSourceChannels?.(profile.channels);
      this.emit();
    });
    this.audio = this.createAudio(playback.streamUrl, (event) => {
      if (
        generation !== this.generation ||
        this.state.playback?.attemptId !== playback.attemptId
      )
        return;
      refreshProfile(event.type);
      this.observe(event);
    }, playback.outputProfile.channels);
    this.audio.setVolume?.(this.volume);
    if (this.state.wantsPlay) this.transitions.fadeIn(this.audio);
    this.emit();
    if (this.state.wantsPlay) this.playAttached(playback, generation);
    else {
      this.state.phase = "paused";
      this.emit();
    }
  }
  private playAttached(playback: Playback, generation: number): void {
    void this.audio?.play().catch((error: unknown) => {
      if (generation !== this.generation || this.state.playback?.attemptId !== playback.attemptId) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        this.state.phase = "paused";
        this.state.wantsPlay = false;
        this.state.message = "请点击播放按钮。";
        this.emit();
      } else this.recover("PLAY_REJECTED");
    });
  }
  private reportStarted(): void {
    const playback = this.state.playback;
    const signal = this.controller?.signal;
    if (!playback || !signal || !this.onPlaybackStarted || this.reportedSession === playback.sessionId) return;
    this.reportedSession = playback.sessionId;
    void this.onPlaybackStarted(playback, signal).catch(() => {
      if (this.reportedSession === playback.sessionId) this.reportedSession = null;
    });
  }
  private observe(event: MediaObservation): void {
    if (event.type === "ended" && this.transitions.userPaused) return;
    // 淡出定位期间若旧位置自然播完，仍以用户刚选择的位置继续。
    if (this.seekingOut && (event.type === "ended" || (event.type === "pause" && this.audio?.ended))) return;
    if (this.state.playback)
      this.state.positionMs = trackPosition(this.state.playback, event.seconds);
    switch (event.type) {
      case "timeupdate": {
        const playback = this.state.playback;
        const end = playback?.seekableRange?.endMs ?? this.state.track?.durationMs;
        const remaining = end == null ? Infinity : end - this.state.positionMs;
        if (playback && this.state.wantsPlay && this.state.phase === "playing" && !this.seekingOut && this.pendingSelection === null)
          this.transitions.fadeEnding(this.audio, remaining, playback.attemptId);
        break;
      }
      case "playing":
        if (this.transitions.pausing || event.paused) return;
        this.waitingForRange = false;
        this.transitions.userPaused = false;
        this.reportStarted();
        this.clearBufferingTimer();
        this.state.phase = "playing";
        this.state.wantsPlay = true;
        this.state.message = null;
        break;
      case "pause":
        this.clearBufferingTimer();
        if (this.state.phase !== "ended") {
          this.state.phase = "paused";
          this.state.wantsPlay = false;
        }
        break;
      case "waiting":
      case "stalled":
        if (this.state.wantsPlay) {
          // 目标字节可能还在下载；原生媒体会在就绪后自动继续同一次定位。
          if (this.waitingForRange) {
            this.state.phase = "seeking";
            this.state.message = "正在下载目标位置的音频…";
            break;
          }
          this.state.phase = "buffering";
          if (!this.bufferingTimer)
            this.bufferingTimer = setTimeout(
              () => this.recover("BUFFERING_TIMEOUT"),
              10_000,
            );
        }
        break;
      case "seeking":
        this.state.phase = "seeking";
        break;
      case "seeked":
        if (this.waitingForRange && (event.readyToPlay || event.paused)) {
          this.waitingForRange = false;
          this.state.message = null;
        }
        this.state.phase = event.paused ? "paused" : event.readyToPlay ? "playing" : "loading";
        if (this.state.phase === "playing") this.clearBufferingTimer();
        break;
      case "ended":
        if (this.waitingForRange) this.state.message = null;
        this.waitingForRange = false;
        this.clearBufferingTimer();
        this.state.phase = "ended";
        this.state.wantsPlay = false;
        break;
      case "error":
        if (this.waitingForRange) {
          this.waitingForRange = false;
          this.fail("无法读取目标位置的音频，请重新播放。");
          return;
        }
        this.recover(`MEDIA_ERROR_${event.errorCode ?? "UNKNOWN"}`);
        return;
    }
    this.emit();
  }
  private recover(code: string): void {
    this.clearBufferingTimer();
    const playback = this.state.playback;
    if (
      !playback ||
      !this.queue ||
      ["recovering", "seeking"].includes(this.state.phase)
    )
      return;
    if (!this.recovery.allow(playback.attemptId)) {
      this.fail("自动恢复已用尽，请重新播放。");
      return;
    }
    this.state.phase = "recovering";
    this.audio?.destroy();
    this.audio = null;
    this.emit();
    this.queue.recover(this.state.positionMs, {
      code,
      message: "Browser observed media failure",
      outputProfile: playback.outputProfile,
    });
  }
  private clearBufferingTimer(): void {
    if (this.bufferingTimer) clearTimeout(this.bufferingTimer);
    this.bufferingTimer = null;
  }
  async seek(positionMs: number): Promise<void> {
    const playback = this.state.playback;
    if (!playback || !seekAllowed(playback, positionMs)) {
      this.state.message = "请输入当前曲目可定位范围内的有效位置。";
      this.emit();
      return;
    }
    const serverSeek = playback.seekMode === "timeRestart";
    const audio = this.audio;
    if (serverSeek ? !this.queue : !audio) return;
    const seconds = (positionMs - playback.positionOriginMs) / 1000;
    if (!serverSeek && !audio?.seekable.some((r) => seconds >= r.start && seconds <= r.end)) {
      this.state.message =
        "目标尚不在当前可定位范围内，请等待加载或选择其他位置。";
      this.emit();
      return;
    }
    // 先使上次定位或选曲失效，再接管同一个输出包络。
    const selection = ++this.selection;
    if (this.pendingSelection !== null) {
      this.pendingSelection = null;
      this.onSelectionCancelled?.();
    }
    const outgoing = this.state.wantsPlay && this.state.phase === "playing"
      ? this.transitions.fadeOut("seekMs", audio) : undefined;
    this.seekingOut = !!outgoing;
    if (outgoing) {
      await outgoing;
      if (selection !== this.selection) return;
      this.seekingOut = false;
      if (this.audio !== audio) return;
    } else this.transitions.reset(audio);
    if (this.state.wantsPlay) this.transitions.prepareIncoming("seekMs");
    if (serverSeek) {
      this.clearBufferingTimer();
      audio?.destroy();
      this.audio = null;
      this.state.phase = "seeking";
      this.state.message = null;
      this.emit();
      this.queue?.seek(positionMs);
    } else if (audio) {
      const resumeEnded = audio.ended && this.state.wantsPlay;
      this.waitingForRange = playback.seekableRange?.growing === true;
      if (this.waitingForRange) this.clearBufferingTimer();
      this.transitions.fadeIn(audio);
      audio.seek(seconds);
      if (resumeEnded) this.playAttached(playback, this.generation);
    }
  }
  private fail(message: string): void {
    this.clearBufferingTimer();
    this.audio?.destroy();
    this.audio = null;
    this.state.phase = "error";
    this.state.message = message;
    this.emit();
  }
  private emit(): void {
    this.onChange?.();
  }
}
