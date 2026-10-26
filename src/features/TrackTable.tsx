import { tr, useLocale, statusText } from "../i18n";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { SourceTrack, Provider } from "../api/types";
import { useServices, useStore } from "../app/services";
import { Cover, duration, ErrorNotice, Icon, IconButton } from "../components/ui";
import { ContextMenu } from "../components/ContextMenu";
import { errorMessage } from "../api/client";
import { AddToPlaylist } from "./playlists/AddToPlaylist";
import { useSourceName } from "../components/use-source-name";
import { MergeSongs } from "./matching/MergeSongs";
import { TrackVersions } from "./matching/TrackVersions";
import { RecordingCover } from "./matching/RecordingCover";
import { useTrackCover } from "../components/use-track-cover";
import { trackAvailabilityMessage, withProviderAvailability } from "../library/track-availability";
import "./matching/matching.css";

export function TrackTable({
  tracks: sourceTracks,
  providers = [],
  queryKey,
  complete = false,
  matchingRevision,
  onMatchingChange,
}: {
  tracks: SourceTrack[];
  providers?: Provider[];
  queryKey: string;
  complete?: boolean;
  matchingRevision?: number;
  onMatchingChange?: () => void;
}) {
  useLocale();
  const sourceName = useSourceName();
  const s = useServices();
  const cachedProviders = useStore(s.libraryApi.providerInstances);
  const providerMap = useMemo(() => new Map([...providers, ...cachedProviders].map((p) => [p.id, p])), [cachedProviders, providers]);
  const tracks = useMemo(() => sourceTracks.map((track) => withProviderAvailability(track, providerMap)), [sourceTracks, providerMap]);
  const sourceTrackMap = useMemo(() => new Map(sourceTracks.flatMap((track) => [...(track.versions ?? []), track])
    .map((track) => [track.sourceTrackId, track])), [sourceTracks]);
  const matchingPending = useStore(s.matchingDecisions.pending);
  const favorites = useStore(s.favorites);
  const [selected, setSelected] = useState(new Set<string>());
  const [add, setAdd] = useState<SourceTrack[] | null>(null);
  const [cover, setCover] = useState<SourceTrack | null>(null);
  const [merge, setMerge] = useState<{ tracks: SourceTrack[]; revision?: number } | null>(null);
  const [message, setMessage] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ tracks: SourceTrack[]; coverTrack?: SourceTrack; x: number; y: number; origin: HTMLElement } | null>(null);
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
  const chosen = tracks.filter((t) => selected.has(t.sourceTrackId));
  const all = tracks.length > 0 && chosen.length === tracks.length;
  useEffect(() => {
    if (check.current) check.current.indeterminate = chosen.length > 0 && !all;
  }, [chosen.length, all]);
  const playable = tracks.filter((t) => t.availability === "available");
  const chosenPlayable = chosen.filter((t) => t.availability === "available");
  function enqueue(items: SourceTrack[]) {
    s.enqueue(items);
    setMessage(
      `已将 ${items.filter((t) => t.availability === "available").length} 首可用曲目加入队列`,
    );
  }
  async function favorite(items: SourceTrack[], value: boolean) {
    const key = queryKey;
    setFavoriteBusy(true);
    setError(null);
    setMessage("");
    const results = await Promise.allSettled(items.map((track) => s.favorites.setFavorite(track, value)));
    setFavoriteBusy(false);
    if (feedbackKey.current !== key) return;
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") setError(errorMessage(failure.reason));
    else setMessage(value ? "已收藏" : "已取消收藏");
  }
  const menuPlayable = menu?.tracks.map((track) => withProviderAvailability(sourceTrackMap.get(track.sourceTrackId) ?? track, providerMap))
    .filter((track) => track.availability === "available") ?? [];
  const menuFavorite = menu?.tracks.every((track) => s.favorites.has(track.sourceTrackId)) ?? false;
  const favoriteDisabled = favoriteBusy || favorites.pending.length > 0 || favorites.loading || !favorites.loaded;
  return (
    <>
      <div className="list-actions">
        {chosen.length ? (
          <>
            <strong>{tr("已选择 {0} 首", { 0: chosen.length })}</strong>
            <button disabled={!chosenPlayable.length} onClick={() => enqueue(chosenPlayable)}>{tr("加入队列")}</button>
            <button onClick={() => setAdd(chosen)}>{tr("添加到歌单")}</button>
            {onMatchingChange && <button disabled={chosen.length < 2 || matchingPending.length > 0} onClick={() => setMerge({ tracks: chosen, revision: matchingRevision })}>{tr("合并歌曲")}</button>}
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
              {!complete ? tr("可选择曲目加入队列") : tr("按来源原始顺序")}
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
                  disabled={!tracks.length}
                  onChange={() =>
                    setSelected(
                      all
                        ? new Set()
                        : new Set(tracks.map((t) => t.sourceTrackId)),
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
            {tracks.map((t, i) => (
              <TrackRow
                key={t.versions && t.versions.length > 1 && t.recordingId ? `recording:${t.recordingId}` : t.sourceTrackId}
                track={t}
                number={i + 1}
                provider={sourceName(
                  providers.find((p) => p.id === t.providerInstanceId) ??
                    t.providerInstanceId,
                )}
                checked={selected.has(t.sourceTrackId)}
                toggle={() =>
                  setSelected((old) => {
                    const next = new Set(old);
                    if (next.has(t.sourceTrackId)) next.delete(t.sourceTrackId);
                    else next.add(t.sourceTrackId);
                    return next;
                  })
                }
                add={() => setAdd([t])}
                isFavorite={s.favorites.has(t.sourceTrackId)}
                favoriteDisabled={favoriteDisabled}
                toggleFavorite={() => void favorite([t], !s.favorites.has(t.sourceTrackId))}
                playNext={() => { s.playNext([t]); setMessage("已设为下一首播放"); }}
                openMenu={(x, y, origin) => {
                  const menuTracks = selected.has(t.sourceTrackId) ? chosen : [t];
                  setMenu({ tracks: menuTracks, coverTrack: menuTracks.length === 1 && t.recordingId ? t : undefined, x, y, origin });
                }}
                openVersionMenu={(track, x, y, origin) => setMenu({ tracks: [track], x, y, origin })}
                matchingRevision={matchingRevision}
                onMatchingChange={onMatchingChange}
              />
            ))}
          </tbody>
        </table>
      </div>
      {menu && <ContextMenu {...menu} label={menu.tracks.length > 1
        ? tr("已选择 {0} 首", { 0: menu.tracks.length }) : menu.tracks[0].title || menu.tracks[0].displayName}
        close={() => setMenu(null)} actions={[
          { label: tr("播放"), icon: "play", disabled: !menuPlayable.length, reason: !menuPlayable.length ? tr("暂无可播放曲目") : undefined,
            run: () => { s.play(menuPlayable[0]); s.enqueue(menuPlayable.slice(1)); } },
          { label: tr("下一首播放"), icon: "next", disabled: !menuPlayable.length, reason: !menuPlayable.length ? tr("暂无可播放曲目") : undefined,
            run: () => { s.playNext(menuPlayable); setMessage("已设为下一首播放"); } },
          { label: tr("添加到播放列表"), icon: "queue", disabled: !menuPlayable.length, reason: !menuPlayable.length ? tr("暂无可播放曲目") : undefined,
            run: () => enqueue(menuPlayable) },
          { label: tr(menuFavorite ? "取消收藏" : "收藏"), icon: "heart", disabled: favoriteDisabled,
            run: () => void favorite(menu.tracks, !menuFavorite) },
          { label: tr("添加到歌单"), icon: "plus", run: () => setAdd(menu.tracks) },
          ...(menu.coverTrack ? [{ label: tr("选择封面"), icon: "album", run: () => setCover(menu.coverTrack!) }] : []),
        ]} />}
      {cover?.recordingId && <RecordingCover recordingId={cover.recordingId} tracks={cover.versions ?? [cover]} close={() => setCover(null)}
        changed={(result) => s.recordingCoverChanged(result.recordingId, result.coverObjectId, result.candidates.map((candidate) => candidate.sourceTrackId))} />}
      {add && <AddToPlaylist tracks={add} close={() => setAdd(null)} />}
      {merge && onMatchingChange && <MergeSongs tracks={merge.tracks} revision={merge.revision}
        close={() => setMerge(null)} refresh={() => { setSelected(new Set()); onMatchingChange(); }} />}
    </>
  );
}
function TrackRow({
  track: t,
  number,
  provider,
  checked,
  toggle,
  add,
  isFavorite,
  favoriteDisabled,
  toggleFavorite,
  playNext,
  openMenu,
  openVersionMenu,
  matchingRevision,
  onMatchingChange,
}: {
  track: SourceTrack;
  number: number;
  provider: string;
  checked: boolean;
  toggle: () => void;
  add: () => void;
  isFavorite: boolean;
  favoriteDisabled: boolean;
  toggleFavorite: () => void;
  playNext: () => void;
  openMenu: (x: number, y: number, origin: HTMLElement) => void;
  openVersionMenu: (track: SourceTrack, x: number, y: number, origin: HTMLElement) => void;
  matchingRevision?: number;
  onMatchingChange?: () => void;
}) {
  useLocale();
  const s = useServices();
  const currentTrack = useStore(s.currentTrack);
  const coverObjectId = useTrackCover(t);
  const [expanded, setExpanded] = useState(false);
  const versions = t.versions ?? [t];
  const playing = versions.some((version) => version.sourceTrackId === currentTrack);
  return (
    <Fragment>
    <tr
      className={`${playing ? "current" : ""} ${checked ? "checked" : ""} ${t.availability !== "available" ? "unavailable" : ""}`}
      tabIndex={-1}
      onContextMenu={(event) => { event.preventDefault(); openMenu(event.clientX, event.clientY, event.currentTarget); }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const origin = event.target as HTMLElement;
          const rect = origin.getBoundingClientRect();
          openMenu(rect.left, rect.bottom, origin);
        }
      }}
    >
      <td>
        <input
          type="checkbox"
          checked={checked}
          onChange={toggle}
          aria-label={tr("选择 {0}", { "0": t.title || t.displayName })}
        />
      </td>
      <td className="row-number">
        {playing ? <span className="equalizer">▂▆▃</span> : number}
      </td>
      <td>
        <div className="track-title">
          <Cover objectId={coverObjectId} />
          <div>
            <button
              className="track-play"
              aria-label={tr("播放 {0}", { "0": t.displayName })}
              title={tr("播放 {0}", { "0": t.displayName })}
              disabled={t.availability !== "available"}
              onClick={() => s.play(t)}
            >
              <Icon name="play" size={14} />
              <span>{t.title || t.displayName}</span>
            </button>
            {versions.length > 1 && <button className="text-button track-expand" aria-expanded={expanded}
              aria-label={tr("展开 {0} 的来源版本", { 0: t.title || t.displayName })}
              onClick={() => setExpanded(!expanded)}>
              <Icon name="chevron" size={14} />{tr("{0} 个来源版本", { 0: versions.length })}
            </button>}
            {t.availability !== "available" && (
              <small className="availability">
                {tr(trackAvailabilityMessage(t.availability))}
              </small>
            )}
          </div>
        </div>
      </td>
      <td>{t.artists?.join(" / ") || "—"}</td>
      <td>{t.album || "—"}</td>
      <td>{provider}</td>
      <td>
        <span className="format">
          {(t.container || t.codec)?.toUpperCase() ?? "—"}
        </span>
      </td>
      <td className="duration">{duration(t.durationMs)}</td>
      <td>
        <div className="track-row-actions">
          <IconButton icon="heart" label={tr(isFavorite ? "取消收藏 {0}" : "收藏 {0}", { 0: t.title || t.displayName })}
            aria-pressed={isFavorite} className={isFavorite ? "is-favorite" : undefined}
            disabled={favoriteDisabled} onClick={toggleFavorite} />
          <IconButton icon="next" label={tr("将 {0} 设为下一首播放", { 0: t.title || t.displayName })}
            disabled={t.availability !== "available"} onClick={playNext} />
          <IconButton icon="plus" label={tr("将 {0} 添加到歌单", { "0": t.displayName })} onClick={add} />
          <IconButton icon="more" label={tr("{0} 的更多操作", { 0: t.title || t.displayName })} aria-haspopup="menu"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              openMenu(rect.left, rect.bottom, event.currentTarget);
            }} />
        </div>
      </td>
    </tr>
    {expanded && versions.length > 1 && <tr className="track-versions"><td colSpan={9}>
      <TrackVersions tracks={versions} revision={matchingRevision} refresh={onMatchingChange}
        openActions={openVersionMenu}
        recordingId={t.recordingId} defaultSourceTrackId={t.sourceTrackId} manualSourceTrackId={t.manualSourceTrackId} />
    </td></tr>}
    </Fragment>
  );
}
