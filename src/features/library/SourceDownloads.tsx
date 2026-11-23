import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { errorMessage } from "../../api/client";
import type { DownloadVersion, SourceTrack } from "../../api/types";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { formatDate, tr } from "../../i18n";

const qualityNames: Record<string, string> = {
  standard: "标准", higher: "较高", exhigh: "极高", lossless: "无损", hires: "高解析度无损",
  jyeffect: "高清臻音", jymaster: "超清母带", sky: "沉浸环绕声",
};

function qualityLabel(version: DownloadVersion): string {
  return Object.hasOwn(qualityNames, version.quality) ? tr(qualityNames[version.quality]) : version.quality;
}

export function versionLabel(version: DownloadVersion): string {
  return [qualityLabel(version), (version.codec || version.container || version.mime).toUpperCase(),
    version.bitrateBps && `${Math.round(version.bitrateBps / 1000)} kbps`].filter(Boolean).join(" · ");
}

export function SourceDownloads({ track }: { track: SourceTrack }) {
  const { libraryApi } = useServices();
  const id = track.sourceTrackId;
  const changed = useSyncExternalStore(libraryApi.downloadChanges.subscribe, () => libraryApi.downloadChanges.value.get(id) ?? 0);
  const [retry, setRetry] = useState(0);
  const [latest, setLatest] = useState<{ source: SourceTrack; revision: number } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<DownloadVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (!changed) return;
    const request = new AbortController();
    setReadError(null);
    void libraryApi.track(id, request.signal).then(source => {
      if (!request.signal.aborted) setLatest({ source, revision: changed });
    }, error => {
      if (!request.signal.aborted) setReadError(errorMessage(error));
    });
    return () => request.abort();
  }, [libraryApi, id, changed, retry, track.downloadVersions]);
  const fresh = changed > 0 && latest?.source.sourceTrackId === id && latest.revision === changed;
  const source = fresh ? latest.source : track;
  const versions = source.downloadVersions ?? [];
  async function remove(version: DownloadVersion) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setDeleteError(null);
    try {
      await libraryApi.deleteDownload(id, version.versionId);
      setConfirm(null);
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (readError) return <ErrorNotice error={readError} retry={() => setRetry(value => value + 1)} />;
  if (!source.downloaded) return null;
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
  return <details className="source-downloads" aria-busy={changed > 0 && !fresh}>
    <summary>{tr("已下载 · {0} 个版本", { 0: versions.length })} · {qualities.join(" / ")}</summary>
    <ul>{versions.map(version => <li key={version.versionId}>
      <span>{description(version)}</span>
      <button type="button" className="text-button" disabled={busy || changed > 0 && !fresh}
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
