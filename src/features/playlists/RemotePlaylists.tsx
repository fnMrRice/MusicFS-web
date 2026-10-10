import { useEffect, useState } from "react";
import { useServices } from "../../app/services";
import { usePages, useResource } from "../../components/query";
import { ErrorNotice, Sentinel } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { errorMessage } from "../../api/client";
import type { RemotePlaylist, SyncJob } from "../../api/content";
export function RemotePlaylists() {
  const s = useServices();
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState("");
  const [external, setExternal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providers = useResource("import-providers", (signal) =>
    s.content.online(signal),
  );
  const page = usePages(
    `remote:${version}`,
    async (after, signal) => {
      const result = await s.content.remote(after, signal);
      return { items: result.items, cursor: result.nextAfter };
    },
    (p) => p.playlistId,
  );
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await s.content.importRemote(instance, external);
      setVersion((v) => v + 1);
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="source-section">
      <div className="section-title">
        <h2>已导入的远程歌单</h2>
        <button onClick={() => setOpen(true)}>导入远程歌单</button>
      </div>
      <p className="muted">
        显式同步后保留本地快照；聚合编辑不会写回远程平台。
      </p>
      <ErrorNotice error={page.error} retry={page.retry} />
      {page.items.map((p) => (
        <RemoteRow
          key={p.playlistId}
          playlist={p}
          updated={() => setVersion((v) => v + 1)}
        />
      ))}
      {page.loading && <p className="loading">正在读取…</p>}
      {!page.loading && !page.items.length && !page.error && (
        <p className="muted">还没有导入的远程歌单。</p>
      )}
      <Sentinel
        active={!!page.cursor && !page.loading && !page.error}
        load={page.more}
      />
      {open && (
        <Modal title="导入远程歌单" close={() => setOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label>
              来源
              <select
                value={instance}
                required
                onChange={(e) => setInstance(e.target.value)}
              >
                <option value="">选择来源</option>
                {providers.data
                  ?.filter(
                    (p) =>
                      p.platform === "netease" &&
                      p.capabilities.some(
                        (c) => c.name === "playlist.observe" && c.supported,
                      ),
                  )
                  .map((p) => (
                    <option key={p.instanceId} value={p.instanceId}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              平台歌单 ID
              <input
                value={external}
                onChange={(e) => setExternal(e.target.value)}
                pattern="[1-9][0-9]{0,19}"
                required
                placeholder="输入平台歌单 ID"
              />
            </label>
            <p className="muted">导入仅登记绑定；导入后请点击同步读取曲目。</p>
            <ErrorNotice error={error || providers.error} />
            <button className="primary" disabled={busy || !instance}>
              {busy ? "正在导入…" : "导入"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
function RemoteRow({
  playlist: p,
  updated,
}: {
  playlist: RemotePlaylist;
  updated: () => void;
}) {
  const s = useServices();
  const [job, setJob] = useState<SyncJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.state)) return;
    const control = new AbortController();
    const timer = setTimeout(() => {
      void s.content.syncJob(job.jobId, control.signal).then(
        (next) => {
          if (control.signal.aborted) return;
          setJob(next);
          if (next.state === "succeeded") updated();
        },
        (e) => {
          if (!control.signal.aborted) setError(errorMessage(e));
        },
      );
    }, 1500);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [job, s, updated]);
  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      setJob(await s.content.sync(p));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="remote-row">
      <div>
        <strong>{p.title || `远程歌单 ${p.externalId}`}</strong>
        <p className="muted">
          {p.instanceId} · {p.stale ? "待同步" : "已有快照"}
          {p.lastSuccessAt &&
            ` · 上次成功 ${new Date(p.lastSuccessAt).toLocaleString("zh-CN")}`}
        </p>
        {p.error && (
          <p className="notice">
            上次同步失败（{p.error.code}），已有内容仍然保留。
          </p>
        )}
        {job && (
          <p role="status">
            同步状态：
            {{
              queued: "排队中",
              running: "同步中",
              succeeded: "已完成",
              failed: "失败",
              cancelled: "已取消",
            }[job.state] ?? job.state}
            {job.error && `（${job.error.code}）`}
          </p>
        )}
        <ErrorNotice error={error} />
      </div>
      <button
        disabled={
          busy || (!error && !!job && ["queued", "running"].includes(job.state))
        }
        onClick={() => {
          void sync();
        }}
      >
        同步
      </button>
    </div>
  );
}
