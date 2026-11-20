import { tr, useLocale, statusText } from "../i18n";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SourceTrack, Provider } from "../api/types";
import { displaySource, tableRowKey, trackKey, trackTitle, type MusicTrack, type TrackItem } from "../api/music-catalog";
import { UnavailableMusicRow } from "./library/UnavailableMusicRow";
import { FavoriteSource } from "./library/FavoriteSource";
import type { FavoriteEntry } from "../api/favorites";
import { useServices, useStore } from "../app/services";
import { ErrorNotice } from "../components/ui";
import { ContextMenu } from "../components/ContextMenu";
import { errorMessage } from "../api/client";
import { AddToPlaylist } from "./playlists/AddToPlaylist";
import { useSourceName } from "../components/use-source-name";
import { MergeSongs } from "./matching/MergeSongs";
import { TrackRow } from "./library/TrackRow";
import { MusicTrackMetadata } from "./scrapers/MusicTrackMetadata";
import { MergeMusicTracks } from "./library/MergeMusicTracks";
import { RecordingCover } from "./matching/RecordingCover";
import { useTrackSelection, type TrackPagination } from "./library/use-track-selection";
import { useTrackBatchActions } from "./library/use-track-batch-actions";
import type { TrackSelection } from "../api/track-selection";
import { withProviderAvailability } from "../library/track-availability";

import "./matching/matching.css";

export function TrackTable({
  tracks: sourceRows,
  providers = [],
  queryKey,
  selectionKey = queryKey,
  complete = false,
  pagination,
  selectionScope,
  matchingRevision,
  onMatchingChange,
  toolbarActions,
  hideEmptyTable = false,
  albumScope,
}: {
  tracks: readonly TrackItem[];
  providers?: Provider[];
  queryKey: string;
  selectionKey?: string;
  complete?: boolean;
  pagination?: TrackPagination;
  selectionScope?: Omit<TrackSelection, "batch" | "sourceTrackIds" | "exclude">;
  matchingRevision?: number;
  onMatchingChange?: () => void;
  toolbarActions?: ReactNode;
  hideEmptyTable?: boolean;
  albumScope?: { albumId: string; revision: number; reload: () => void };
}) {
  useLocale();
  const sourceName = useSourceName();
  const s = useServices();
  const cachedProviders = useStore(s.libraryApi.providerInstances);
  const providerMap = useMemo(() => new Map([...providers, ...cachedProviders].map((p) => [p.id, p])), [providers, cachedProviders]);
  const rows = useMemo(() => sourceRows.map((item) => "trackId" in item
    ? { ...item, selectedSource: item.selectedSource && withProviderAvailability(item.selectedSource, providerMap) }
    : withProviderAvailability(item, providerMap)), [sourceRows, providerMap]);
  const entries = rows.map((item) => ({ item, source: displaySource(item) }));
  const tracks = entries.map(({ source }) => source).filter((item) => item !== null);
  const matchingPending = useStore(s.matchingDecisions.pending);
  const favorites = useStore(s.favorites);
  const [add, setAdd] = useState<{items: TrackItem[]; pinned?: string; selection?: TrackSelection} | null>(null);
  const [cover, setCover] = useState<SourceTrack | null>(null);
  const [metadata, setMetadata] = useState<{ trackId: string; bySource: boolean; mode: "search" | "names" } | null>(null);
  const [favoriteSource, setFavoriteSource] = useState<FavoriteEntry | null>(null);
  const [merge, setMerge] = useState<{ tracks: SourceTrack[]; revision?: number; selection?: TrackSelection } | null>(null);
  const [albumMerge, setAlbumMerge] = useState<MusicTrack[] | null>(null);
  const [message, setMessage] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ items: TrackItem[]; selection?: boolean; version?: SourceTrack; coverTrack?: SourceTrack; x: number; y: number; origin: HTMLElement } | null>(null);
  const selectionComplete = pagination ? !pagination.loading && !pagination.hasMore && !pagination.error : complete;
  const selection = useTrackSelection(selectionKey, rows, selectionComplete, pagination, setError);
  const batch = useTrackBatchActions(selectionKey, selection.state, rows, setMessage, setError);
  const busy = selection.busy || batch.busy;
  const sources = (items: TrackItem[]) => items.map(displaySource).filter((item) => item !== null);
  // 曲目目录含无来源条目，必须按曲目身份分页；来源列表可使用服务端批量范围。
  const batchScope = rows.some((item) => "trackId" in item) ? undefined : selectionScope;
  function runSelected(action: (items: TrackItem[]) => void, bulk?: (value: TrackSelection) => void) {
    selection.run(action, batchScope && bulk ? (exclude) => bulk({ ...batchScope, batch: true, exclude }) : undefined);
  }
  const addSelected = () => runSelected((items) => setAdd({items}), (value) => setAdd({items: selection.chosen, selection: value}));
  const feedbackKey = useRef(queryKey);
  feedbackKey.current = queryKey;
  const check = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setMessage("");
    setError(null);
    setMenu(null);
    setCover(null);
    setMetadata(null);
    setAdd(null);
    setMerge(null);
    setAlbumMerge(null);
  }, [queryKey]);
  useEffect(() => { void s.favorites.load(); }, [s]);
  const chosen = selection.chosen;
  const chosenSources = chosen.map(displaySource).filter((t) => t !== null);
  useEffect(() => {
    if (check.current) check.current.indeterminate = selection.indeterminate;
  }, [selection.indeterminate]);
  const playable = tracks.filter((t) => t.availability === "available");
  function enqueue(items: SourceTrack[]) {
    s.enqueue(items);
    setMessage(
      `已将 ${items.filter((t) => t.availability === "available").length} 首可用曲目加入队列`,
    );
  }
  async function favorite(items: TrackItem[], value: boolean, forcedSourceTrackId?: string) {
    const key = queryKey;
    setFavoriteBusy(true);
    setError(null);
    setMessage("");
    const results = await Promise.allSettled(items.map((track) => s.favorites.setFavorite(track, value, forcedSourceTrackId)));
    setFavoriteBusy(false);
    if (feedbackKey.current !== key) return;
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") setError(errorMessage(failure.reason));
    else setMessage(value ? "已收藏" : "已取消收藏");
  }
  const menuItems = menu?.selection ? selection.chosen : menu?.items ?? [];
  const singleTrack = !menu?.version && (!menu?.selection || !selection.needsComplete) && menuItems.length === 1 ? menuItems[0] : null;
  function openTrackMetadata(mode: "search" | "names") {
    if (singleTrack) setMetadata({ trackId: trackKey(singleTrack), bySource: !("trackId" in singleTrack), mode });
  }
  const menuSources = menu?.version ? [menu.version] : menuItems.map(displaySource);
  const menuPlayable = menuSources.filter((track): track is SourceTrack => track?.availability === "available");
  const menuFavorite = (!menu?.selection || !selection.needsComplete) && menuItems.every((track) => s.favorites.has(trackKey(track)));
  const favoriteEntry = menuItems.length === 1 && (!menu?.selection || !selection.needsComplete) ? s.favorites.getEntry(trackKey(menuItems[0])) : undefined;
  const favoriteDisabled = busy || favoriteBusy || favorites.pending.length > 0 || favorites.loading || !favorites.loaded;
  function runMenu(action: (items: TrackItem[]) => void, bulk?: (value: TrackSelection) => void) {
    if (menu?.selection) runSelected(action, bulk ?? ((value) => batch.resolve(value, action)));
    else action(menu?.version ? [menu.version] : menuItems);
  }
  const menuCanPlay = menuPlayable.length > 0 || (menu?.selection && selection.needsComplete);
  return (
    <>
      <div className="list-actions">
        {selection.hasSelection ? (
          <>
            <strong>{selection.label}</strong>
            <button disabled={busy || (!chosenSources.some((t) => t.availability === "available") && !selection.needsComplete)} onClick={() => runSelected((items) => enqueue(sources(items)), (value) => batch.resolve(value, enqueue))}>{tr("加入队列")}</button>
            <button disabled={busy} onClick={addSelected}>{tr("添加到歌单")}</button>
            {albumScope && <button disabled={busy || matchingRevision === undefined || chosen.length < 2 && !selection.needsComplete}
              onClick={() => runSelected(items => { if (items.every(item => "trackId" in item)) setAlbumMerge(items); })}>{tr("合并歌曲")}</button>}
            {onMatchingChange && !albumScope && <button disabled={busy || (chosen.length < 2 && !selection.needsComplete) || chosenSources.length !== chosen.length || matchingPending.length > 0}
              onClick={() => runSelected((items) => setMerge({ tracks: sources(items), revision: matchingRevision }),
                (value) => setMerge({ tracks: chosenSources, revision: matchingRevision, selection: value }))}>{tr("合并歌曲")}</button>}
            <button disabled={favoriteDisabled} onClick={() => runSelected((items) => void favorite(items, true), (value) => batch.favorite(value, true))}>
              {tr("收藏")}
            </button>
            <button
              className="text-button"
              onClick={selection.clear}
            >
              {tr("清空选择")}
            </button>
          </>
        ) : (
          <>
            <button
              className="primary"
              disabled={!complete || !playable.length}
              title={
                !complete
                  ? tr("完整结果读取结束后可播放全部；也可以勾选曲目播放")
                  : undefined
              }
              onClick={() => s.play(playable[0], playable)}
            >
              {tr("播放全部")}
            </button>
            <button
              disabled={!complete || !playable.length}
              onClick={() => enqueue(playable)}
            >
              {tr("加入队列")}
            </button>
            <span className="muted action-hint">
              {!complete && tr("可选择曲目加入队列")}
            </span>
          </>
        )}
        <div className="list-actions-end">
          {toolbarActions}
          <select
              aria-label={tr("曲目排序")}
              disabled
              title={tr("等待服务端提供完整查询排序能力")}
            >
              <option>{tr("默认顺序")}</option>
          </select>
        </div>
      </div>
      {selection.busy && <p className="loading" role="status">{tr("正在读取全部选中曲目…")}</p>}
      {batch.busy && <p className="loading" role="status">{tr("正在处理选中曲目…")}</p>}
      {message && (
        <p className="feedback" role="status">
          {statusText(message)}
        </p>
      )}
      <ErrorNotice error={error && error !== favorites.error ? error : null} />
      <ErrorNotice error={favorites.error} retry={() => void s.favorites.load(true)} />
      {(!hideEmptyTable || rows.length > 0) && <div className="table-wrap">
        <table className="tracks">
          <thead>
            <tr>
              <th>
                <input
                  ref={check}
                  type="checkbox"
                  aria-label={tr("全选曲目")}
                  title={tr("选择当前列表的全部曲目，包括尚未加载的曲目")}
                  checked={selection.all}
                  disabled={!rows.length}
                  onChange={selection.toggleAll}
                />
              </th>
              <th className="row-number">#</th>
              <th>{tr("曲名")}</th>
              <th>{tr("歌手")}</th>
              <th>{tr("专辑")}</th>
              <th>{tr("来源")}</th>
              <th>{tr("格式")}</th>
              <th>{tr("时长")}</th>
              <th>
                <span className="sr-only">{tr("操作")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ item, source: t }, i) => t ? (
              <TrackRow
                key={tableRowKey(item)}
                track={t}
                localizedTitles={"trackId" in item ? item.localizedTitles : undefined}
                number={i + 1}
                provider={sourceName(
                  providers.find((p) => p.id === t.providerInstanceId) ??
                    t.providerInstanceId,
                )}
                checked={selection.isSelected(tableRowKey(item))}
                toggle={() => selection.toggle(tableRowKey(item))}
                add={() => setAdd({items: [item]})}
                isFavorite={s.favorites.has(trackKey(item))}
                favoriteDisabled={favoriteDisabled}
                toggleFavorite={() => void favorite([item], !s.favorites.has(trackKey(item)))}
                playNext={() => { s.playNext([t]); setMessage("已设为下一首播放"); }}
                openMenu={(x, y, origin) => {
                  const items = selection.isSelected(tableRowKey(item)) ? chosen : [item];
                  setMenu({ items, selection: selection.isSelected(tableRowKey(item)), coverTrack: items.length === 1 && !selection.needsComplete && t.recordingId ? t : undefined, x, y, origin });
                }}
                openVersionMenu={(track, x, y, origin) => setMenu({ items: [item], version: track, x, y, origin })}
                matchingRevision={matchingRevision}
                onMatchingChange={onMatchingChange}
              />
            ) : "trackId" in item && <UnavailableMusicRow key={tableRowKey(item)} track={item} number={i + 1} checked={selection.isSelected(tableRowKey(item))} toggle={() => selection.toggle(tableRowKey(item))}
              isFavorite={s.favorites.has(item.trackId)} favoriteDisabled={favoriteDisabled}
              favorite={() => void favorite([item], !s.favorites.has(item.trackId))} add={() => setAdd({items:[item]})}
              openMenu={(x, y, origin) => setMenu({ items: selection.isSelected(tableRowKey(item)) ? chosen : [item], selection: selection.isSelected(tableRowKey(item)), x, y, origin })} />)}
          </tbody>
        </table>
      </div>}
      {menu && <ContextMenu {...menu} label={menu.selection ? selection.label : menu.items.length > 1
        ? tr("已选择 {0} 首", { 0: menu.items.length }) : trackTitle(menu.version ?? menu.items[0])}
        close={() => setMenu(null)} actions={[
          { label: tr("播放"), icon: "play", disabled: busy || !menuCanPlay, reason: !menuCanPlay ? tr("暂无可播放曲目") : undefined,
            run: () => runMenu((items) => { const available = sources(items).filter((track) => track.availability === "available"); if (available.length) { s.play(available[0]); s.enqueue(available.slice(1)); } }) },
          { label: tr("下一首播放"), icon: "next", disabled: busy || !menuCanPlay, reason: !menuCanPlay ? tr("暂无可播放曲目") : undefined,
            run: () => runMenu((items) => { s.playNext(sources(items).filter((track) => track.availability === "available")); setMessage("已设为下一首播放"); }) },
          { label: tr("添加到播放列表"), icon: "queue", disabled: busy || !menuCanPlay, reason: !menuCanPlay ? tr("暂无可播放曲目") : undefined,
            run: () => runMenu((items) => enqueue(sources(items))) },
          { label: tr(menuFavorite ? "取消收藏" : "收藏"), icon: "heart", disabled: favoriteDisabled,
            run: () => menu.selection ? runSelected((items) => void favorite(items, !menuFavorite), (value) => batch.favorite(value, !menuFavorite)) : void favorite(menu.items, !menuFavorite, menu.version?.sourceTrackId) },
          ...(favoriteEntry ? [{ label: tr("编辑收藏来源"), icon: "heart", run: () => setFavoriteSource(favoriteEntry) }] : []),
          { label: tr("添加到歌单"), icon: "plus", disabled: busy, run: () => menu.selection ? addSelected() : setAdd({ items: menu.items, pinned: menu.version?.sourceTrackId }) },
          ...(singleTrack ? [
            { label: tr("搜索在线资料"), icon: "search", run: () => openTrackMetadata("search") },
            { label: tr("编辑多语言曲名"), icon: "settings", run: () => openTrackMetadata("names") },
          ] : []),
          ...(menu.coverTrack ? [{ label: tr("选择封面"), icon: "album", run: () => setCover(menu.coverTrack!) }] : []),
        ]} />}
      {metadata && <MusicTrackMetadata {...metadata} close={() => setMetadata(null)} applied={onMatchingChange} />}
      {cover?.recordingId && <RecordingCover recordingId={cover.recordingId} tracks={cover.versions ?? [cover]} close={() => setCover(null)}
        changed={(result) => s.recordingCoverChanged(result.recordingId, result.coverObjectId, result.candidates.map((candidate) => candidate.sourceTrackId))} />}
      {add && <AddToPlaylist tracks={add.items} pinned={add.pinned} selection={add.selection} close={() => setAdd(null)} />}
      {favoriteSource && <FavoriteSource entry={favoriteSource} close={() => setFavoriteSource(null)} />}
      {merge && onMatchingChange && <MergeSongs tracks={merge.tracks} revision={merge.revision} selection={merge.selection}
        close={() => setMerge(null)} refresh={() => { selection.clear(); onMatchingChange(); }} />}
      {albumMerge && albumScope && matchingRevision !== undefined && <MergeMusicTracks albumId={albumScope.albumId} albumRevision={albumScope.revision}
        matchingRevision={matchingRevision} tracks={albumMerge} close={() => setAlbumMerge(null)}
        applied={() => { setAlbumMerge(null); selection.clear(); albumScope.reload(); }} />}
    </>
  );
}
