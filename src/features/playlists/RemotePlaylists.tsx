import { tr, useLocale, formatDate } from "../../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useServices } from "../../app/services";
import { usePages, useResource } from "../../components/query";
import { ErrorNotice, Sentinel } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { ApiError, errorMessage } from "../../api/client";
import type { Observation, RemotePlaylist, SyncJob } from "../../api/content";
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
      updated(result.playlist);
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
          key={p.playlistId}
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
              {tr("导入仅登记绑定；导入后请点击同步读取曲目。")}
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
  const [job, setJob] = useState<SyncJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const retryStatus = useRef<() => void>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!jobId) return;
    const watcher = s.activity.watch("playlistSync", async (signal) => {
      try {
        const next = await s.content.syncJob(jobId, signal);
        if (signal.aborted) return;
        setJob(next);
        setError(null);
        if (!["queued", "running"].includes(next.state)) {
          const playlist = await s.content.remotePlaylist(p.playlistId, signal);
          if (signal.aborted) return;
          updated(playlist);
          watcher.stop();
          setJobId(null);
        }
      } catch (cause) {
        if (signal.aborted) return;
        setError(errorMessage(cause));
        if (cause instanceof ApiError && cause.status === 404) setJobId(null);
      }
    });
    retryStatus.current = () => watcher.refresh();
    return () => {
      watcher.stop();
      retryStatus.current = undefined;
    };
  }, [jobId, p.playlistId, s, updated]);
  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      const receipt = await s.content.sync(p);
      setJob(null);
      setJobId(receipt.jobId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="remote-row">
      <div>
        <strong>{p.title || tr("远程歌单 {0}", { "0": p.externalId })}</strong>
        <p className="muted">
          {sourceLabel} · {p.stale ? tr("待同步") : tr("已有快照")}
          {p.lastSuccessAt &&
            tr(" · 上次成功 {0}", { "0": formatDate(p.lastSuccessAt) })}
        </p>
        {p.error && (
          <p className="notice">
            {tr("上次同步失败（{0}），已有内容仍然保留。", { 0: p.error.code })}
          </p>
        )}
        {job && (
          <p role="status">
            {tr("同步状态：")}
            {{
              queued: tr("排队中"),
              running: tr("同步中"),
              succeeded: tr("已完成"),
              failed: tr("失败"),
              cancelled: tr("已取消"),
            }[job.state] ?? job.state}
            {job.error && `（${job.error.code}）`}
          </p>
        )}
        <ErrorNotice error={error} retry={jobId ? () => retryStatus.current?.() : undefined} />
      </div>
      <button
        disabled={busy || jobId !== null}
        onClick={() => {
          void sync();
        }}
      >
        {tr("同步")}
      </button>
    </div>
  );
}
