import { useMemo, useState } from "react";
import { WorkPackagesApi, type PackageNode } from "../../../api/work-packages";
import { useServices } from "../../../app/services";
import { useResource } from "../../../components/query";
import { ErrorNotice } from "../../../components/ui";
import { tr, useLocale } from "../../../i18n";
import { PackageImport } from "./PackageImport";
import { PackageTree } from "./PackageTree";
import { PackageAttachment } from "./PackageAttachment";
import "./packages.css";

export function WorkPackages({ workId, editable }: { workId: string; editable: boolean }) {
  useLocale();
  const services = useServices();
  const api = useMemo(() => new WorkPackagesApi(services.client, workId), [services, workId]);
  const packages = useResource(`work-packages:${workId}`, (signal) => api.list(signal));
  const [selectedId, setSelectedId] = useState("");
  const [importing, setImporting] = useState(false);
  const [attachment, setAttachment] = useState<PackageNode | null>(null);
  const selected = packages.data?.find((item) => item.packageId === selectedId) ?? packages.data?.[0];
  return <section className="work-panel work-packages" aria-label={tr("作品包")}>
    <div className="package-section-heading"><h3>{tr("作品包")}</h3><div className="work-actions">
      <button disabled={!editable} onClick={() => setImporting(true)}>{tr("导入本地作品包")}</button>
      <button onClick={() => { setAttachment(null); packages.reload(); }}>{tr("刷新作品包")}</button>
    </div></div>
    <ErrorNotice error={packages.error} retry={packages.reload} />
    {packages.loading && <p role="status">{tr("正在读取作品包…")}</p>}
    {!packages.loading && !packages.error && !packages.data?.length && <p className="muted">{tr("尚未关联本地作品包。导入后可以浏览多层目录、播放音轨和查看附件。")}</p>}
    {selected && <>
      <label className="package-selection">{tr("选择作品包")}<select aria-label={tr("选择作品包")} value={selected.packageId}
        onChange={(event) => { setSelectedId(event.target.value); setAttachment(null); }}>
        {packages.data?.map((item) => <option value={item.packageId} key={item.packageId}>{item.name} · {item.relativePath}</option>)}
      </select></label>
      <p className="muted">{tr("目录：{0}。请选择具体版本目录播放，避免混入不同编码或内容版本。", { 0: selected.relativePath })}</p>
      <PackageTree key={`${selected.packageId}:${selected.revision}`} value={selected} attachment={setAttachment} />
    </>}
    {importing && <PackageImport api={api} workId={workId} close={() => setImporting(false)} refresh={packages.reload}
      saved={(value) => { setImporting(false); setSelectedId(value.packageId); packages.reload(); }} />}
    {selected && attachment && <PackageAttachment api={api} packageId={selected.packageId} node={attachment} close={() => setAttachment(null)} />}
  </section>;
}
