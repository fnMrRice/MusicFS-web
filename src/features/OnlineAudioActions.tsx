import { useEffect, useRef, useState } from "react";
import { useServices } from "../app/services";
import { errorMessage } from "../api/client";
import { resolveOnlineAudio } from "../api/online-audio";
import { ErrorNotice } from "../components/ui";
import { tr } from "../i18n";

export function OnlineAudioActions({ instance, external, title }: { instance: string; external: string; title: string }) {
  const s = useServices();
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { request.current?.abort(); }, [instance, external]);
  async function resolve(play: boolean) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const track = await resolveOnlineAudio(s.client, instance, external, controller.signal);
      if (controller.signal.aborted) return;
      if (play) s.play(track); else s.enqueue([track]);
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return <div>
    <button disabled={busy} aria-label={tr("播放 {0}", { 0: title })} onClick={() => void resolve(true)}>{tr("播放")}</button>{" "}
    <button disabled={busy} onClick={() => void resolve(false)}>{tr("加入队列")}</button>
    {busy && <span role="status"> {tr("正在准备音频…")} <button onClick={() => request.current?.abort()}>{tr("取消")}</button></span>}
    <ErrorNotice error={error} />
  </div>;
}
