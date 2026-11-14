import { tr, useLocale, statusText } from "../i18n";
import { useEffect, useRef, useState } from "react";
import type { SourceTrack, Provider } from "../api/types";
import { displaySource, tableRowKey, trackKey, trackTitle, type TrackItem } from "../api/music-catalog";
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
import { RecordingCover } from "./matching/RecordingCover";

import "./matching/matching.css";

export function TrackTable({
  tracks: rows,
  providers = [],
  queryKey,
  complete = false,
  matchingRevision,
  onMatchingChange,
}: {
  tracks: readonly TrackItem[];
  providers?: Provider[];
  queryKey: string;
  complete?: boolean;
  matchingRevision?: number;
  onMatchingChange?: () => void;
}) {
  useLocale();
  const sourceName = useSourceName();
  const entries = rows.map((item) => ({ item, source: displaySource(item) }));
  const tracks = entries.map(({ source }) => source).filter((item) => item !== null);
  const s = useServices();
  const matchingPending = useStore(s.matchingDecisions.pending);
  const favorites = useStore(s.favorites);
  const [selected, setSelected] = useState(new Set<string>());
  const [add, setAdd] = useState<{items: TrackItem[]; pinned?: string} | null>(null);
  const [cover, setCover] = useState<SourceTrack | null>(null);
  const [favoriteSource, setFavoriteSource] = useState<FavoriteEntry | null>(null);
  const [merge, setMerge] = useState<{ tracks: SourceTrack[]; revision?: number } | null>(null);
  const [message, setMessage] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ items: TrackItem[]; version?: SourceTrack; coverTrack?: SourceTrack; x: number; y: number; origin: HTMLElement } | null>(null);
  const feedbackKey = useRef(queryKey);
  feedbackKey.current = queryKey;
  const check = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSelected(new Set());
    setMessage("");
    setError(null);
    setMenu(null);
    setCover(null);
  }, [queryKey]);
  useEffect(() => { void s.favorites.load(); }, [s]);
  const chosen = rows.filter((t) => selected.has(tableRowKey(t)));
  const chosenSources = chosen.map(displaySource).filter((t) => t !== null);
  const all = rows.length > 0 && chosen.length === rows.length;
  function toggle(id: string) {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  useEffect(() => {
    if (check.current) check.current.indeterminate = chosen.length > 0 && !all;
  }, [chosen.length, all]);
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
  const menuSources = menu?.version ? [menu.version] : menu?.items.map(displaySource) ?? [];
  const menuPlayable = menuSources.filter((track): track is SourceTrack => track?.availability === "available");
  const menuFavorite = menu?.items.every((track) => s.favorites.has(trackKey(track))) ?? false;
  const favoriteEntry = menu?.items.length === 1 ? s.favorites.getEntry(trackKey(menu.items[0])) : undefined;
  const favoriteDisabled = favoriteBusy || favorites.pending.length > 0 || favorites.loading || !favorites.loaded;
  return (
    <>
      <div className="list-actions">
        {chosen.length ? (
          <>
            <strong>{tr("已选择 {0} 首", { 0: chosen.length })}</strong>
            <button disabled={!chosenSources.some((t) => t.availability === "available")} onClick={() => enqueue(chosenSources)}>{tr("加入队列")}</button>
            <button onClick={() => setAdd({items: chosen})}>{tr("添加到歌单")}</button>
            {onMatchingChange && <button disabled={chosen.length < 2 || chosenSources.length !== chosen.length || matchingPending.length > 0} onClick={() => setMerge({ tracks: chosenSources, revision: matchingRevision })}>{tr("合并歌曲")}</button>}
            <button disabled={favoriteDisabled} onClick={() => void favorite(chosen, true)}>
              {tr("收藏")}
            </button>
            <button
              className="text-button"
              onClick={() => setSelected(new Set())}
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
            <select
              aria-label={tr("曲目排序")}
              disabled
              title={tr("等待服务端提供完整查询排序能力")}
            >
              <option>{tr("默认顺序")}</option>
            </select>
          </>
        )}
      </div>
      {message && (
        <p className="feedback" role="status">
          {statusText(message)}
        </p>
      )}
      <ErrorNotice error={error && error !== favorites.error ? error : null} />
      <ErrorNotice error={favorites.error} retry={() => void s.favorites.load(true)} />
      <div className="table-wrap">
        <table className="tracks">
          <thead>
            <tr>
              <th>
                <input
                  ref={check}
                  type="checkbox"
                  aria-label={tr("全选当前已返回曲目")}
                  title={tr("仅选择当前已返回的曲目，后续追加项不会自动选中")}
                  checked={all}
                  disabled={!rows.length}
                  onChange={() =>
                    setSelected(
                      all
                        ? new Set()
                        : new Set(rows.map(tableRowKey)),
                    )
                  }
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
                number={i + 1}
                provider={sourceName(
                  providers.find((p) => p.id === t.providerInstanceId) ??
                    t.providerInstanceId,
                )}
                checked={selected.has(tableRowKey(item))}
                toggle={() => toggle(tableRowKey(item))}
                add={() => setAdd({items: [item]})}
                isFavorite={s.favorites.has(trackKey(item))}
                favoriteDisabled={favoriteDisabled}
                toggleFavorite={() => void favorite([item], !s.favorites.has(trackKey(item)))}
                playNext={() => { s.playNext([t]); setMessage("已设为下一首播放"); }}
                openMenu={(x, y, origin) => {
                  const items = selected.has(tableRowKey(item)) ? chosen : [item];
                  setMenu({ items, coverTrack: items.length === 1 && t.recordingId ? t : undefined, x, y, origin });
                }}
                openVersionMenu={(track, x, y, origin) => setMenu({ items: [item], version: track, x, y, origin })}
                matchingRevision={matchingRevision}
                onMatchingChange={onMatchingChange}
              />
            ) : "trackId" in item && <UnavailableMusicRow key={tableRowKey(item)} track={item} number={i + 1} checked={selected.has(tableRowKey(item))} toggle={() => toggle(tableRowKey(item))}
              isFavorite={s.favorites.has(item.trackId)} favoriteDisabled={favoriteDisabled}
              favorite={() => void favorite([item], !s.favorites.has(item.trackId))} add={() => setAdd({items:[item]})}
              openMenu={(x, y, origin) => setMenu({ items: selected.has(tableRowKey(item)) ? chosen : [item], x, y, origin })} />)}
          </tbody>
        </table>
      </div>
      {menu && <ContextMenu {...menu} label={menu.items.length > 1
        ? tr("已选择 {0} 首", { 0: menu.items.length }) : trackTitle(menu.version ?? menu.items[0])}
        close={() => setMenu(null)} actions={[
          { label: tr("播放"), icon: "play", disabled: !menuPlayable.length, reason: !menuPlayable.length ? tr("暂无可播放曲目") : undefined,
            run: () => { s.play(menuPlayable[0]); s.enqueue(menuPlayable.slice(1)); } },
          { label: tr("下一首播放"), icon: "next", disabled: !menuPlayable.length, reason: !menuPlayable.length ? tr("暂无可播放曲目") : undefined,
            run: () => { s.playNext(menuPlayable); setMessage("已设为下一首播放"); } },
          { label: tr("添加到播放列表"), icon: "queue", disabled: !menuPlayable.length, reason: !menuPlayable.length ? tr("暂无可播放曲目") : undefined,
            run: () => enqueue(menuPlayable) },
          { label: tr(menuFavorite ? "取消收藏" : "收藏"), icon: "heart", disabled: favoriteDisabled,
            run: () => void favorite(menu.items, !menuFavorite, menu.version?.sourceTrackId) },
          ...(favoriteEntry ? [{ label: tr("编辑收藏来源"), icon: "heart", run: () => setFavoriteSource(favoriteEntry) }] : []),
          { label: tr("添加到歌单"), icon: "plus", run: () => setAdd({ items: menu.items, pinned: menu.version?.sourceTrackId }) },
          ...(menu.coverTrack ? [{ label: tr("选择封面"), icon: "album", run: () => setCover(menu.coverTrack!) }] : []),
        ]} />}
      {cover?.recordingId && <RecordingCover recordingId={cover.recordingId} tracks={cover.versions ?? [cover]} close={() => setCover(null)}
        changed={(result) => s.recordingCoverChanged(result.recordingId, result.coverObjectId, result.candidates.map((candidate) => candidate.sourceTrackId))} />}
      {add && <AddToPlaylist tracks={add.items} pinned={add.pinned} close={() => setAdd(null)} />}
      {favoriteSource && <FavoriteSource entry={favoriteSource} close={() => setFavoriteSource(null)} />}
      {merge && onMatchingChange && <MergeSongs tracks={merge.tracks} revision={merge.revision}
        close={() => setMerge(null)} refresh={() => { setSelected(new Set()); onMatchingChange(); }} />}
    </>
  );
}
