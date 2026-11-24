import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useServices, useStore } from "../app/services";
import { useResource } from "../components/query";
import { Empty, ErrorNotice, IconButton } from "../components/ui";
import { useSourceName } from "../components/use-source-name";
import { tr, useLocale } from "../i18n";
import { TrackTable } from "./TrackTable";
import { LocalPlaylistSync } from "./playlists/LinkedPlaylistSync";
import { favoritesPlaylistId } from "../api/playlist-links";

export function Favorites() {
  useLocale();
  const s = useServices();
  const favorites = useStore(s.favorites);
  const sourceName = useSourceName();
  const [params, setParams] = useSearchParams();
  const provider = params.get("source") || "all";
  const providers = useResource("providers", (signal) => s.libraryApi.providers(signal));
  useEffect(() => s.activity.watch("playlistSync", async () => { await s.favorites.load(true); }).stop, [s]);
  const tracks = favorites.items.filter((track) => provider === "all" || track.selectedSource?.versions?.some((source) => source.providerInstanceId === provider));
  return <section aria-label={tr("我的收藏")}>
    <div className="filters">
      <select aria-label={tr("来源")} value={provider} onChange={(event) => {
        const next = new URLSearchParams(params);
        next.set("source", event.target.value);
        setParams(next);
      }}>
        <option value="all">{tr("全部来源")}</option>
        {providers.data?.map((item) => <option key={item.id} value={item.id}>{sourceName(item)}</option>)}
      </select>
      <span className="muted">{tr("{0} 首", { 0: tracks.length })}</span>
      <div className="filter-end"><IconButton icon="refresh" label={tr("刷新列表")} disabled={favorites.loading}
        onClick={() => { providers.reload(); void s.favorites.load(true); }} /></div>
    </div>
    <LocalPlaylistSync playlistId={favoritesPlaylistId} />
    <ErrorNotice error={providers.error} retry={providers.reload} />
    {!tracks.length && <ErrorNotice error={favorites.error} retry={() => { void s.favorites.load(true); }} />}
    {tracks.length > 0 && <TrackTable tracks={tracks} providers={providers.data ?? []}
      queryKey={`favorites:${provider}`} complete={favorites.loaded && !favorites.loading && !favorites.error} />}
    {favorites.loading && <p className="loading" role="status">{tr("正在加载…")}</p>}
    {favorites.loaded && !favorites.loading && !favorites.error && !tracks.length && <Empty title={tr("暂无收藏音乐")} icon="heart" />}
  </section>;
}
