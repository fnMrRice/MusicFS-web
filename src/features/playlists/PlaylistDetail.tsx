import { useState } from "react";
import { useParams } from "react-router-dom";
import { useServices } from "../../app/services";
import { usePages, useResource } from "../../components/query";
import { Cover, Empty, ErrorNotice, Sentinel } from "../../components/ui";
import { errorMessage } from "../../api/client";
import { TrackTable } from "../TrackTable";
import { PlaylistEditor } from "./PlaylistEditor";
import { useCatalog } from "../catalog";

export function PlaylistDetail() {
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
      {detail.loading && <p className="loading">正在读取歌单…</p>}
      {detail.data && (
        <>
          <div className="detail-heading">
            <Cover large />
            <div>
              <p className="eyebrow">我的歌单</p>
              <h2>{detail.data.name}</h2>
              <p className="muted">
                {detail.data.bindings.length} 个来源规则 ·{" "}
                {detail.data.stale
                  ? "规则已更新，需重新生成快照"
                  : "当前快照已发布"}
              </p>
              <div className="list-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    void rebuild();
                  }}
                >
                  {busy ? "正在生成…" : "更新歌单快照"}
                </button>
                <button onClick={() => setEditing(true)}>
                  编辑名称与聚合规则
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
            <Empty title="歌单尚未生成曲目快照">
              添加曲目或聚合规则后，点击“更新歌单快照”。
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
  const s = useServices();
  const [confirmation, setConfirmation] = useState(false);
  const catalog = useCatalog();
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
        items: p.items,
        cursor: p.nextOffset === null ? null : String(p.nextOffset),
      };
    },
    (e) => e.entryId,
  );
  const tracks = pages.items.flatMap((e) => {
    const track = catalog.data?.find(
      (t) => t.sourceTrackId === e.source.sourceTrackId,
    );
    return track ? [track] : [];
  });
  const unresolved = pages.items.filter(
    (e) =>
      !e.source.sourceTrackId ||
      (catalog.data &&
        !catalog.data.some((t) => t.sourceTrackId === e.source.sourceTrackId)),
  );
  return (
    <>
      {confirmation && (
        <p className="notice">
          部分隐藏规则需要确认；请在服务端处理后更新快照。
        </p>
      )}
      {pages.items.some((e) =>
        e.provenance.some((p) => p.state === "suspectedRemoved"),
      ) && (
        <p className="notice">
          部分远程曲目疑似移除，当前快照仍保留其来源贡献。
        </p>
      )}
      <ErrorNotice error={pages.error} retry={pages.retry} />
      <ErrorNotice error={catalog.error} retry={catalog.reload} />
      {(pages.loading || catalog.loading) && (
        <p className="loading">正在读取曲目…</p>
      )}
      {tracks.length > 0 && (
        <TrackTable
          tracks={tracks}
          queryKey={`${id}:${revision}`}
          complete={
            !pages.cursor &&
            !pages.loading &&
            !pages.error &&
            !catalog.loading &&
            !catalog.error &&
            !unresolved.length
          }
        />
      )}
      {unresolved.length > 0 && (
        <p className="notice">
          此快照另有 {unresolved.length}{" "}
          个远程或暂不可读取的来源引用；当前接口不提供这些曲目的播放和完整展示信息。
        </p>
      )}
      {!pages.items.length && !pages.loading && !pages.error && (
        <Empty title="歌单中还没有曲目">从音乐库选择喜欢的歌曲加入吧。</Empty>
      )}
      <Sentinel
        active={!!pages.cursor && !pages.loading && !pages.error}
        load={pages.more}
      />
    </>
  );
}
