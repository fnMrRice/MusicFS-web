import { tr, useLocale, formatDate } from "../../i18n";
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useServices } from "../../app/services";
import { usePages, useResource } from "../../components/query";
import { ErrorNotice, Sentinel } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { errorMessage } from "../../api/client";
import type { Observation, RemotePlaylist } from "../../api/content";
import { PlaylistSyncStatus } from "./PlaylistSyncStatus";
import { syncFailureMessage } from "./sync-error";
import { useSourceName } from "../../components/use-source-name";
export function RemotePlaylists() {
  useLocale();
  const sourceName = useSourceName();
  const s = useServices();
  const [updates, setUpdates] = useState(new Map<string, RemotePlaylist>());
  const updated = useCallback((playlist: RemotePlaylist) => {
    setUpdates(previous => new Map(previous).set(playlist.playlistId, playlist));
  }, []);
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState("");
  const [external, setExternal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Observation | null>(null);
  const providers = useResource("import-providers", (signal) =>
    s.content.online(signal),
  );
  const page = usePages(
    "remote",
    async (after, signal) => {
      const result = await s.content.remote(after, signal);
      return { items: result.items, cursor: result.nextAfter };
    },
    (p) => p.playlistId,
  );
  const playlists = new Map(page.items.map(playlist => [playlist.playlistId, playlist]));
  for (const [id, playlist] of updates) playlists.set(id, playlist);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const bilibili = providers.data?.find((p) => p.instanceId === instance)?.platform === "bilibili";
      const canonical = bilibili ? (await s.content.playlistReference(instance, external)).externalId : external.trim();
      const result = await s.content.importRemote(instance, canonical);
      updated({ ...result.playlist, jobId: result.jobId });
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const showPreview = async () => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const canonical = (await s.content.playlistReference(instance, external)).externalId;
      setPreview(await s.content.observation(instance, canonical));
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const bilibili = providers.data?.find((p) => p.instanceId === instance)?.platform === "bilibili";
  return (
    <section className="source-section">
      <div className="section-title">
        <h2>{tr("已导入的远程歌单")}</h2>
        <button onClick={() => setOpen(true)}>{tr("导入远程歌单")}</button>
      </div>
      <p className="muted">
        {tr("点击同步可以更新已导入歌单的本地快照。")}
      </p>
      <ErrorNotice error={page.error} retry={page.retry} />
      {Array.from(playlists.values(), p => (
        <RemoteRow
          key={`${p.playlistId}:${p.jobId ?? ""}`}
          playlist={p}
          sourceLabel={sourceName(
            providers.data?.find(
              (source) => source.instanceId === p.instanceId,
            ) ?? p.instanceId,
          )}
          updated={updated}
        />
      ))}
      {page.loading && <p className="loading">{tr("正在读取…")}</p>}
      {!page.loading && !playlists.size && !page.error && (
        <p className="muted">{tr("还没有导入的远程歌单。")}</p>
      )}
      <Sentinel
        active={!!page.cursor && !page.loading && !page.error}
        load={page.more}
      />
      {open && (
        <Modal title={tr("导入远程歌单")} close={() => setOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label>
              {tr("来源")}
              <select
                value={instance}
                required
                onChange={(e) => { setInstance(e.target.value); setPreview(null); }}
              >
                <option value="">{tr("选择来源")}</option>
                {providers.data
                  ?.filter(
                    (p) =>
                      p.capabilities.some(
                        (c) => c.name === "playlist.observe" && c.supported,
                      ),
                  )
                  .map((p) => (
                    <option key={p.instanceId} value={p.instanceId}>
                      {sourceName(p)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {tr("平台歌单 ID")}
              <input
                value={external}
                onChange={(e) => { setExternal(e.target.value); setPreview(null); }}
                pattern={bilibili ? undefined : "[1-9][0-9]{0,19}"}
                required
                placeholder={tr(bilibili ? "收藏夹链接、favorite:编号或 am 编号" : "输入平台歌单 ID")}
              />
            </label>
            <p className="muted">
              {tr("导入后会自动同步歌单，并将曲目及其来源加入曲库。")}
            </p>
            <ErrorNotice error={error || providers.error} />
            {bilibili && <>
              <p className="muted">{tr("公开视频按全部分 P 展开；私有内容和登录暂不支持。")}</p>
              <button type="button" disabled={busy || !external.trim()} onClick={() => void showPreview()}>{tr("预览")}</button>
              {preview && <p role="status">{preview.playlist.title} · {tr("{0} 首", { 0: preview.entries.length })} · {tr(preview.complete ? "完整观测" : "观测不完整，已有快照不会被替换")} {" "}
                <Link to={`/discover/${encodeURIComponent(instance)}/${encodeURIComponent(preview.playlist.externalId)}`}>{tr("查看曲目")}</Link></p>}
            </>}
            <button className="primary" disabled={busy || !instance}>
              {busy ? tr("正在导入…") : tr("导入")}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
function RemoteRow({
  playlist: p,
  sourceLabel,
  updated,
}: {
  playlist: RemotePlaylist;
  sourceLabel: string;
  updated: (playlist: RemotePlaylist) => void;
}) {
  useLocale();
  const s = useServices();
  return (
    <div className="remote-row">
      <div>
        <strong>{p.title || tr("远程歌单 {0}", { "0": p.externalId })}</strong>
        <p className="muted">
          {sourceLabel} · {p.stale ? tr("待同步") : tr("已有快照")}
          {p.lastSuccessAt &&
            tr(" · 上次成功 {0}", { "0": formatDate(p.lastSuccessAt) })}
        </p>
        {p.error && !p.jobId && (
          <p className="notice">
            {syncFailureMessage(p.error.code)} <small>({p.error.code})</small>
          </p>
        )}
      </div>
      <div className="linked-playlist-sync">
        <PlaylistSyncStatus jobId={p.jobId}
          start={async signal => s.content.sync(await s.content.remotePlaylist(p.playlistId, signal), signal)}
          synced={() => s.sourcePlaylists.revalidate(p.instanceId, true)}
          finished={async (signal, _job, current) => {
            const playlist = current ?? await s.content.remotePlaylist(p.playlistId, signal);
            if (!signal.aborted) updated(playlist);
          }} />
      </div>
    </div>
  );
}
