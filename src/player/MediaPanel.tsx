import { tr, useLocale } from "../i18n";
import { useEffect, useState } from "react";
import { useServices } from "../app/services";
import type { SourceTrack } from "../api/types";
import { ErrorNotice } from "../components/ui";
import { errorMessage } from "../api/client";
import { useTrackCover } from "../components/use-track-cover";
interface Binding {
  objectId: string;
  field: string;
  current: boolean;
  state: string;
}
export function MediaPanel({ track }: { track: SourceTrack | null }) {
  useLocale();
  const s = useServices();
  const coverObjectId = useTrackCover(track);
  const [state, setState] = useState({
    lyrics: "",
    artwork: "",
    loading: true,
    error: "",
  });
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    setState({ lyrics: "", artwork: "", loading: true, error: "" });
    if (!track) return () => controller.abort();
    void (async () => {
      try {
        const selection = await s.client.request<{ bindings: Binding[] }>(
          `/source-tracks/${encodeURIComponent(track.sourceTrackId)}/media-selection`,
          { signal: controller.signal },
        );
        const active = selection.bindings.filter(
          (b) => b.current && b.state === "available",
        );
        const artwork = active.find((b) => b.field === "artwork");
        const lyrics = active.find((b) => b.field === "lyrics");
        let text = "";
        if (lyrics) {
          const response = await fetch(
            s.client.url(`/media/${encodeURIComponent(lyrics.objectId)}`),
            { signal: controller.signal, credentials: "same-origin" },
          );
          if (response.status === 401) s.clear();
          if (!response.ok) throw new Error("Unable to read lyrics");
          text = await response.text();
        }
        if (artwork)
          url = s.client.url(`/media/${encodeURIComponent(artwork.objectId)}`);
        if (!controller.signal.aborted)
          setState({ lyrics: text, artwork: url, loading: false, error: "" });
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            lyrics: "",
            artwork: "",
            loading: false,
            error: errorMessage(error),
          });
      }
    })();
    return () => controller.abort();
  }, [track?.sourceTrackId, track?.assetId, s]);
  const artwork = coverObjectId === undefined ? state.artwork : coverObjectId ? s.client.url(`/media/${encodeURIComponent(coverObjectId)}`) : "";
  return (
    <>
      <ErrorNotice error={state.error} />
      {state.loading ? (
        <p>{tr("正在读取内容…")}</p>
      ) : (
        <>
          {artwork && (
            <img
              className="media-artwork"
              src={artwork}
              loading="lazy"
              alt={tr("当前曲目封面")}
            />
          )}
          {state.lyrics ? (
            <pre className="lyrics">{state.lyrics}</pre>
          ) : (
            <p className="muted">{tr("此曲目暂无可用歌词。")}</p>
          )}
          <p className="muted">
            {tr("展示当前来源已选用的歌词；暂不进行逐句定位。")}
          </p>
        </>
      )}
    </>
  );
}
