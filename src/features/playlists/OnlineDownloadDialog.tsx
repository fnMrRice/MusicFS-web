import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import type { OnlineInstance } from "../../api/content";
import { createDownloadJob, getDownloadOptions, type DownloadJob, type DownloadOptions } from "../../api/online-downloads";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { localizedPluginText } from "../../components/source-name";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";

export function OnlineDownloadDialog({ source, externalIds, title, close, created }: {
  source: OnlineInstance; externalIds: string[]; title?: string; close: () => void;
  created: (job: DownloadJob, quality: DownloadOptions["options"][number]) => void;
}) {
  const { client } = useServices();
  const { locale } = useLocale();
  const options = useResource(`download-qualities:${source.instanceId}:${source.accountRevision ?? ""}`, signal =>
    getDownloadOptions(client, source.instanceId, signal));
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const mounted = useRef(true);
  const attempt = useRef<{ quality: string; key: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const quality = chosen ?? options.data?.defaultQuality;
  const option = options.data?.options.find(item => item.value === quality);
  async function start() {
    if (active.current || !option) return;
    const quality = option.value;
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      if (attempt.current?.quality !== quality) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        attempt.current = { quality, key: Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("") };
      }
      const job = await createDownloadJob(client, source.instanceId, {
        externalIds, quality, accountId: source.accountId ?? "",
        accountRevision: source.accountRevision,
      }, attempt.current.key);
      created(job, option);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <Modal title={tr("选择下载音质")} close={() => { if (!active.current) close(); }}>
    <p>{externalIds.length === 1 && title ? title : tr("已选择 {0} 首曲目", { 0: externalIds.length })}</p>
    {options.loading && <p role="status">{tr("正在读取可用音质…")}</p>}
    <ErrorNotice error={options.error} retry={options.reload} />
    {options.data && (options.data.options.length
      ? <label>{tr("本次下载音质")}<select disabled={busy} value={quality ?? ""} onChange={e => setChosen(e.target.value)}>
        {options.data.options.map(option => <option key={option.value} value={option.value}>
          {localizedPluginText(option.label, option.localizedLabels, locale)}</option>)}
      </select></label>
      : <p>{tr("此来源暂无可用下载音质。")}</p>)}
    <ErrorNotice error={error} />
    <div className="list-actions">
      <button type="button" className="primary" disabled={!option || busy} onClick={() => void start()}>
        {tr(busy ? "正在提交下载…" : "开始下载")}</button>
      <button type="button" disabled={busy} onClick={close}>{tr("取消")}</button>
    </div>
  </Modal>;
}
