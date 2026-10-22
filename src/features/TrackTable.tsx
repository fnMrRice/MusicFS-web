import { tr, useLocale, statusText } from "../i18n";
import { Fragment, useEffect, useRef, useState } from "react";
import type { SourceTrack, Provider } from "../api/types";
import { useServices, useStore } from "../app/services";
import { Cover, duration, Icon, IconButton } from "../components/ui";
import { AddToPlaylist } from "./playlists/AddToPlaylist";
import { useSourceName } from "../components/use-source-name";
import { MergeSongs } from "./matching/MergeSongs";
import { TrackVersions } from "./matching/TrackVersions";
import "./matching/matching.css";

export function TrackTable({
  tracks,
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
  const matchingPending = useStore(s.matchingDecisions.pending);
  const [selected, setSelected] = useState(new Set<string>());
  const [add, setAdd] = useState<SourceTrack[] | null>(null);
  const [merge, setMerge] = useState<{ tracks: SourceTrack[]; revision?: number } | null>(null);
  const [message, setMessage] = useState("");
  const check = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSelected(new Set());
    setMessage("");
  }, [queryKey]);
  const chosen = tracks.filter((t) => selected.has(t.sourceTrackId));
  const all = tracks.length > 0 && chosen.length === tracks.length;
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
  return (
    <>
      <div className="list-actions">
        {chosen.length ? (
          <>
            <strong>{tr("已选择 {0} 首", { 0: chosen.length })}</strong>
            <button onClick={() => enqueue(chosen)}>{tr("加入队列")}</button>
            <button onClick={() => setAdd(chosen)}>{tr("添加到歌单")}</button>
            {onMatchingChange && <button disabled={chosen.length < 2 || matchingPending.length > 0} onClick={() => setMerge({ tracks: chosen, revision: matchingRevision })}>{tr("合并歌曲")}</button>}
            <button disabled title={tr("收藏接口尚未提供")}>
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
                matchingRevision={matchingRevision}
                onMatchingChange={onMatchingChange}
              />
            ))}
          </tbody>
        </table>
      </div>
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
  matchingRevision,
  onMatchingChange,
}: {
  track: SourceTrack;
  number: number;
  provider: string;
  checked: boolean;
  toggle: () => void;
  add: () => void;
  matchingRevision?: number;
  onMatchingChange?: () => void;
}) {
  useLocale();
  const s = useServices();
  const currentTrack = useStore(s.currentTrack);
  const [expanded, setExpanded] = useState(false);
  const versions = t.versions ?? [t];
  const playing = versions.some((version) => version.sourceTrackId === currentTrack);
  return (
    <Fragment>
    <tr
      className={`${playing ? "current" : ""} ${checked ? "checked" : ""} ${t.availability !== "available" ? "unavailable" : ""}`}
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
          <Cover />
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
                {t.availability === "offline"
                  ? tr("来源离线")
                  : t.availability === "missing"
                    ? tr("文件缺失")
                    : tr("可用性未知")}
              </small>
            )}
          </div>
        </div>
      </td>
      <td>{t.artists?.join(" / ") || "—"}</td>
      <td className="muted">—</td>
      <td>{provider}</td>
      <td>
        <span className="format">
          {(t.container || t.codec)?.toUpperCase() ?? "—"}
        </span>
      </td>
      <td className="duration">{duration(t.durationMs)}</td>
      <td>
        <IconButton
          icon="plus"
          label={tr("将 {0} 添加到歌单", { "0": t.displayName })}
          onClick={add}
        />
      </td>
    </tr>
    {expanded && versions.length > 1 && <tr className="track-versions"><td colSpan={9}>
      <TrackVersions tracks={versions} revision={matchingRevision} refresh={onMatchingChange}
        recordingId={t.recordingId} defaultSourceTrackId={t.sourceTrackId} manualSourceTrackId={t.manualSourceTrackId} />
    </td></tr>}
    </Fragment>
  );
}
