import { useEffect, useRef, useState } from "react";
import type { SourceTrack, Provider } from "../api/types";
import { useServices, useStore } from "../app/services";
import { Cover, duration, IconButton } from "../components/ui";
import { AddToPlaylist } from "./playlists/AddToPlaylist";

export function TrackTable({
  tracks,
  providers = [],
  queryKey,
  complete = false,
}: {
  tracks: SourceTrack[];
  providers?: Provider[];
  queryKey: string;
  complete?: boolean;
}) {
  const s = useServices();
  const [selected, setSelected] = useState(new Set<string>());
  const [add, setAdd] = useState<SourceTrack[] | null>(null);
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
            <strong>已选择 {chosen.length} 首</strong>
            <button onClick={() => enqueue(chosen)}>加入队列</button>
            <button onClick={() => setAdd(chosen)}>添加到歌单</button>
            <button disabled title="收藏接口尚未提供">
              收藏
            </button>
            <button
              className="text-button"
              onClick={() => setSelected(new Set())}
            >
              清空选择
            </button>
          </>
        ) : (
          <>
            <button
              className="primary"
              disabled={!complete || !playable.length}
              title={
                !complete
                  ? "完整结果读取结束后可播放全部；也可以勾选曲目播放"
                  : undefined
              }
              onClick={() => s.play(playable[0], playable)}
            >
              播放全部
            </button>
            <button
              disabled={!complete || !playable.length}
              onClick={() => enqueue(playable)}
            >
              加入队列
            </button>
            <span className="muted action-hint">
              {!complete ? "可选择曲目加入队列" : "按来源原始顺序"}
            </span>
            <select aria-label="曲目排序" disabled title="等待服务端提供完整查询排序能力"><option>默认顺序</option></select>
          </>
        )}
      </div>
      {message && (
        <p className="feedback" role="status">
          {message}
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
                  aria-label="全选当前已返回曲目"
                  title="仅选择当前已返回的曲目，后续追加项不会自动选中"
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
              <th>曲名</th>
              <th>歌手</th>
              <th>专辑</th>
              <th>来源</th>
              <th>格式</th>
              <th>时长</th>
              <th>
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t, i) => (
              <TrackRow
                key={t.sourceTrackId}
                track={t}
                number={i + 1}
                provider={
                  providers.find((p) => p.id === t.providerInstanceId)?.name ??
                  t.providerInstanceId
                }
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
              />
            ))}
          </tbody>
        </table>
      </div>
      {add && <AddToPlaylist tracks={add} close={() => setAdd(null)} />}
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
}: {
  track: SourceTrack;
  number: number;
  provider: string;
  checked: boolean;
  toggle: () => void;
  add: () => void;
}) {
  const s = useServices();
  const playing = useStore(s.currentTrack) === t.sourceTrackId;
  return (
    <tr
      className={`${playing ? "current" : ""} ${checked ? "checked" : ""} ${t.availability !== "available" ? "unavailable" : ""}`}
    >
      <td>
        <input
          type="checkbox"
          checked={checked}
          onChange={toggle}
          aria-label={`选择 ${t.title || t.displayName}`}
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
              aria-label={`播放 ${t.displayName}`}
              disabled={t.availability !== "available"}
              onClick={() => s.play(t)}
            >
              {t.title || t.displayName}
            </button>
            {t.availability !== "available" && (
              <small className="availability">
                {t.availability === "offline"
                  ? "来源离线"
                  : t.availability === "missing"
                    ? "文件缺失"
                    : "可用性未知"}
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
          label={`将 ${t.displayName} 添加到歌单`}
          onClick={add}
        />
      </td>
    </tr>
  );
}
