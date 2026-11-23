import { useEffect, useRef, useState } from "react";
import { useServices } from "../app/services";
import { errorMessage } from "../api/client";
import { resolveOnlineAudio } from "../api/online-audio";
import { withRateLimitRetry } from "../api/rate-limit";
import { ErrorNotice } from "../components/ui";
import { tr } from "../i18n";

export function useOnlineAudioActions(instance: string, external: string | undefined) {
  const s = useServices();
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { request.current?.abort(); }, [instance, external]);
  async function resolve(play: boolean) {
    if (!external || request.current) return;
    const controller = new AbortController();
    const release = play ? s.onlinePlaylistPlayback.beginSingleTrack(controller) : undefined;
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const track = await withRateLimitRetry(
        () => resolveOnlineAudio(s.client, instance, external, controller.signal), controller.signal);
      if (controller.signal.aborted) return;
      if (play) s.play(track); else s.enqueue([track]);
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      release?.();
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return { busy, error, play: () => void resolve(true), enqueue: () => void resolve(false), cancel: () => request.current?.abort() };
}

export function OnlineAudioFeedback({ busy, error, cancel }: ReturnType<typeof useOnlineAudioActions>) {
  return <>
    {busy && <span role="status"> {tr("正在准备音频…")} <button type="button" onClick={cancel}>{tr("取消")}</button></span>}
    <ErrorNotice error={error} />
  </>;
}

export function OnlineAudioActions({ instance, external, title }: { instance: string; external: string; title: string }) {
  const actions = useOnlineAudioActions(instance, external);
  return <div>
    <button type="button" disabled={actions.busy} aria-label={tr("播放 {0}", { 0: title })} onClick={actions.play}>{tr("播放")}</button>{" "}
    <button type="button" disabled={actions.busy} onClick={actions.enqueue}>{tr("加入队列")}</button>
    <OnlineAudioFeedback {...actions} />
  </div>;
}
