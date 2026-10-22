import { tr, useLocale } from "../../i18n";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useServices } from "../../app/services";
import { usePages, useResource } from "../../components/query";
import { Cover, Empty, ErrorNotice, Sentinel } from "../../components/ui";
import { errorMessage } from "../../api/client";
import { TrackTable } from "../TrackTable";
import { PlaylistEditor } from "./PlaylistEditor";
import { resolvePlaylistTracks } from "./playlist-tracks";

export function PlaylistDetail() {
  useLocale();
  const { id = "" } = useParams();
  const s = useServices();
  const detail = useResource(`playlist:${id}`, (signal) =>
    s.content.playlist(id, signal),
  );
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rebuild = async () => {
    if (!detail.data) return;
    setBusy(true);
    setError(null);
    try {
      await s.content.rebuild(detail.data);
      detail.reload();
      await s.reloadPlaylists();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <ErrorNotice error={detail.error} retry={detail.reload} />
      {detail.loading && <p className="loading">{tr("正在读取歌单…")}</p>}
      {detail.data && (
        <>
          <div className="detail-heading">
            <Cover large />
            <div>
              <p className="eyebrow">{tr("我的歌单")}</p>
              <h2>{detail.data.name}</h2>
              <p className="muted">
                {tr("{0} 个来源规则 · {1}", {
                  0: detail.data.bindings.length,
                  1: detail.data.stale
                    ? tr("规则已更新，需重新生成快照")
                    : tr("当前快照已发布"),
                })}
              </p>
              <div className="list-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    void rebuild();
                  }}
                >
                  {busy ? tr("正在生成…") : tr("更新歌单快照")}
                </button>
                <button onClick={() => setEditing(true)}>
                  {tr("编辑名称与聚合规则")}
                </button>
              </div>
            </div>
          </div>
          <ErrorNotice error={error} />
          {detail.data.snapshotRevision > 0 ? (
            <PlaylistTracks
              key={`${id}:${detail.data.snapshotRevision}`}
              id={id}
              revision={detail.data.snapshotRevision}
            />
          ) : (
            <Empty title={tr("歌单尚未生成曲目快照")}>
              {tr("添加曲目或聚合规则后，点击“更新歌单快照”。")}
            </Empty>
          )}
          {editing && (
            <PlaylistEditor
              playlist={detail.data}
              close={() => setEditing(false)}
              saved={() => {
                setEditing(false);
                detail.reload();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
function PlaylistTracks({ id, revision }: { id: string; revision: number }) {
  useLocale();
  const s = useServices();
  const [confirmation, setConfirmation] = useState(false);
  const pages = usePages(
    `snapshot:${id}:${revision}`,
    async (cursor, signal) => {
      const p = await s.content.snapshot(
        id,
        revision,
        Number(cursor ?? 0),
        signal,
      );
      if (!signal.aborted) setConfirmation(p.needsConfirmation.length > 0);
      return {
        items: await resolvePlaylistTracks(p.items, (sourceTrackId) => s.libraryApi.track(sourceTrackId, signal), signal),
        cursor: p.nextOffset === null ? null : String(p.nextOffset),
      };
    },
    (e) => e.entryId,
  );
  const tracks = pages.items.flatMap((e) => e.track ? [e.track] : []);
  const unresolved = pages.items.filter((e) => !e.track);
  return (
    <>
      {confirmation && (
        <p className="notice">
          {tr("部分隐藏规则需要确认；请在服务端处理后更新快照。")}
        </p>
      )}
      {pages.items.some((e) =>
        e.provenance.some((p) => p.state === "suspectedRemoved"),
      ) && (
        <p className="notice">
          {tr("部分远程曲目疑似移除，当前快照仍保留其来源贡献。")}
        </p>
      )}
      <ErrorNotice error={pages.error} retry={pages.retry} />
      {pages.loading && (
        <p className="loading">{tr("正在读取曲目…")}</p>
      )}
      {tracks.length > 0 && (
        <TrackTable
          tracks={tracks}
          queryKey={`${id}:${revision}`}
          complete={
            !pages.cursor &&
            !pages.loading &&
            !pages.error &&
            !unresolved.length
          }
        />
      )}
      {unresolved.length > 0 && (
        <p className="notice">
          {tr(
            "此快照另有 {0} 个远程或暂不可读取的来源引用；当前接口不提供这些曲目的播放和完整展示信息。",
            { 0: unresolved.length },
          )}
        </p>
      )}
      {!pages.items.length && !pages.loading && !pages.error && (
        <Empty title={tr("歌单中还没有曲目")}>
          {tr("从音乐库选择喜欢的歌曲加入吧。")}
        </Empty>
      )}
      <Sentinel
        active={!!pages.cursor && !pages.loading && !pages.error}
        load={pages.more}
      />
    </>
  );
}
