import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage, withRequestId } from "../api/client";
import { onlineDownloadDirectory, type DownloadDirectory } from "../api/online-downloads";
import { useServices, useStore } from "../app/services";
import { useResource } from "../components/query";
import { ErrorNotice } from "../components/ui";
import { tr } from "../i18n";

export function OnlineDownloadDirectory() {
  const { ready, session } = useStore(useServices().auth);
  return session?.user.role === "admin"
    ? <DirectorySettings key={JSON.stringify([ready?.instanceId, session.user.id])} />
    : null;
}

function DirectorySettings() {
  const { client } = useServices();
  const directory = useResource("online-download-directory", signal => onlineDownloadDirectory(client, { signal }));
  return <section className="settings-card download-directory" aria-labelledby="download-directory-heading">
    <h3 id="download-directory-heading">{tr("在线音乐下载目录")}</h3>
    {directory.loading && <p role="status">{tr("正在读取设置…")}</p>}
    <ErrorNotice error={directory.error} retry={directory.reload} />
    {directory.data && <DirectoryForm initial={directory.data} />}
  </section>;
}

function DirectoryForm({ initial }: { initial: DownloadDirectory }) {
  const { client } = useServices();
  const [saved, setSaved] = useState(initial);
  const [path, setPath] = useState(initial.path);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);

  async function save(next: string) {
    if (operation.current || next === saved.path) return;
    const request = new AbortController();
    operation.current = request;
    setSaving(true);
    setConfirmed(false);
    setError(null);
    try {
      const result = await onlineDownloadDirectory(client, { path: next, signal: request.signal });
      if (!request.signal.aborted) {
        setSaved(result);
        setPath(result.path);
        setConfirmed(true);
      }
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof ApiError && e.code === "INVALID_ARGUMENT"
        ? withRequestId("请填写服务器上可写的绝对目录路径。", e) : errorMessage(e));
    } finally {
      operation.current = null;
      if (!request.signal.aborted) setSaving(false);
    }
  }

  return <form onSubmit={event => { event.preventDefault(); void save(path); }}>
    <p className="muted" id="download-directory-hint">
      {tr("新下载和边下边播的音频会存到新目录。已下载的音乐仍可从原位置播放。")}
    </p>
    <label>{tr("服务器上的绝对路径")}
      <input type="text" value={path} dir="auto" spellCheck={false} autoComplete="off"
        placeholder={tr("使用默认目录")} aria-describedby="download-directory-hint" disabled={saving}
        onChange={event => { setPath(event.target.value); setConfirmed(false); setError(null); }} />
    </label>
    <p className="muted">{tr("当前保存位置")} <bdi>{saved.effectivePath}</bdi></p>
    <ErrorNotice error={error} />
    <div className="download-directory-actions">
      <button type="submit" className="primary" disabled={saving || path === saved.path}>
        {tr(saving ? "正在保存…" : "保存设置")}
      </button>
      <button type="button" disabled={saving || !saved.path} onClick={() => void save("")}>{tr("恢复默认目录")}</button>
      {confirmed && <span className="muted" role="status">{tr("设置已保存。")}</span>}
    </div>
  </form>;
}
