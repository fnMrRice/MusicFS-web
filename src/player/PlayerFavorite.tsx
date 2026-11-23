import { memo, useState } from "react";
import { errorMessage } from "../api/client";
import type { SourceTrack } from "../api/types";
import { useServices, useStore } from "../app/services";
import { IconButton } from "../components/ui";
import { statusText, tr, useLocale } from "../i18n";
import { favoriteTrackId } from "../library/favorites";

export const PlayerFavorite = memo(function PlayerFavorite({ track }: { track: SourceTrack | null }) {
  useLocale();
  const { favorites } = useServices();
  const state = useStore(favorites);
  const [error, setError] = useState<string | null>(null);
  const selected = !!track && favorites.has(favoriteTrackId(track));
  const retryLoad = !state.loaded && !!state.error;
  const label = retryLoad && track ? tr("重新加载收藏")
    : track ? tr(selected ? "取消收藏 {0}" : "收藏 {0}", { 0: track.title || track.displayName }) : tr("收藏当前曲目");

  async function toggle() {
    if (!track) return;
    setError(null);
    if (retryLoad) {
      await favorites.load(true);
      setError(favorites.value.error);
      return;
    }
    try {
      await favorites.setFavorite(track, !selected);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return <>
    <IconButton icon="heart" className="player-favorite" label={label} aria-pressed={selected}
      disabled={!track || state.loading || (!state.loaded && !retryLoad) || state.pending.length > 0}
      onClick={() => void toggle()} />
    {error && <div className="playback-message" role="alert">
      {statusText(error)} <button type="button" onClick={() => setError(null)}>{tr("关闭")}</button>
    </div>}
  </>;
});
