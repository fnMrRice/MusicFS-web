import { useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import type { DownloadVersion, SourceTrack } from "../../api/types";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { formatDate, tr } from "../../i18n";

import { qualityLabel, versionLabel } from "./download-format";
import { useSourceDownloads } from "./use-source-downloads";

export function SourceDownloads({ track }: { track: SourceTrack }) {
  const { libraryApi } = useServices();
  const id = track.sourceTrackId;
  const { downloaded, versions, pending, error, retry } = useSourceDownloads(track);
  const [confirm, setConfirm] = useState<DownloadVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const submitting = useRef(false);
  async function remove(version: DownloadVersion) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setDeleteError(null);
    try {
      await libraryApi.deleteDownload(id, version);
      setConfirm(null);
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (error) return <ErrorNotice error={error} retry={retry} />;
  if (!downloaded) return null;
  if (versions.length === 0) return <small className="muted">{tr("已下载")}</small>;
  const qualities = [...new Set(versions.map(version => qualityLabel(version) || versionLabel(version)))];
  function label(version: DownloadVersion) {
    const name = versionLabel(version);
    const duplicates = versions.filter(other => other.versionId !== version.versionId && versionLabel(other) === name);
    if (duplicates.length === 0) return name;
    const prefix = version.versionId.slice(0, 8);
    return `${name} · #${duplicates.some(other => other.versionId.startsWith(prefix)) ? version.versionId : prefix}`;
  }
  function description(version: DownloadVersion) {
    return `${label(version)} · ${(version.sizeBytes / 1048576).toFixed(2)} MiB · ${formatDate(version.downloadedAt)}`;
  }
  return <details className="source-downloads" aria-busy={pending}>
    <summary>{tr("已下载 · {0} 个版本", { 0: versions.length })} · {qualities.join(" / ")}</summary>
    <ul>{versions.map(version => <li key={version.versionId}>
      <span>{description(version)}</span>
      <button type="button" className="text-button" disabled={busy || pending}
        aria-label={tr("删除下载版本 {0}", { 0: label(version) })}
        onClick={() => { setDeleteError(null); setConfirm(version); }}>{tr("删除")}</button>
    </li>)}</ul>
    {confirm && <Modal title={tr("删除下载版本")} close={() => { if (!submitting.current) setConfirm(null); }}>
      <p>{tr("删除《{0}》的这个下载版本？", { 0: track.title || track.displayName })}</p>
      <p>{description(confirm)}</p>
      <ErrorNotice error={deleteError} />
      <div className="list-actions">
        <button type="button" disabled={busy} onClick={() => setConfirm(null)}>{tr("取消")}</button>
        <button type="button" className="danger" disabled={busy} onClick={() => void remove(confirm)}>{tr("删除")}</button>
      </div>
    </Modal>}
  </details>;
}
