import { useEffect, useMemo, useState } from "react";
import { WorkPackagesApi, type PackageKind, type PackageNode, type PackageSelection } from "../../../api/work-packages";
import { useServices } from "../../../app/services";
import { useResource } from "../../../components/query";
import { ErrorNotice } from "../../../components/ui";
import { tr, useLocale } from "../../../i18n";
import { PackageImport } from "./PackageImport";
import { PackageTree } from "./PackageTree";
import { PackageAttachment } from "./PackageAttachment";
import { packageKindName } from "./tree";
import "./packages.css";

export function WorkPackages({ workId, editable, initialKind = "directory", autoImport = false, importOpened }: {
  workId: string; editable: boolean; initialKind?: PackageKind; autoImport?: boolean; importOpened?: () => void;
}) {
  useLocale();
  const services = useServices();
  const api = useMemo(() => new WorkPackagesApi(services.client, workId), [services, workId]);
  const packages = useResource(`work-packages:${workId}`, (signal) => api.list(signal));
  const [selectedId, setSelectedId] = useState("");
  const [importing, setImporting] = useState<{ kind: PackageKind; selection?: PackageSelection } | null>(null);
  const [attachment, setAttachment] = useState<PackageNode | null>(null);
  const selected = packages.data?.find((item) => item.packageId === selectedId) ?? packages.data?.[0];
  useEffect(() => {
    if (autoImport && editable) { setImporting({ kind: initialKind }); importOpened?.(); }
  }, [autoImport, editable, initialKind, importOpened]);
  return <section className="work-panel work-packages" aria-label={tr("本地副本")}>
    <div className="package-section-heading"><h3>{tr("本地副本")}</h3><div className="work-actions">
      <button disabled={!editable} onClick={() => setImporting({ kind: initialKind })}>{tr(initialKind === "cd_dump" ? "导入 CD 抓轨" : "导入本地副本")}</button>
      <button onClick={() => { setAttachment(null); packages.reload(); }}>{tr("刷新本地副本")}</button>
    </div></div>
    <ErrorNotice error={packages.error} retry={packages.reload} />
    {packages.loading && <p role="status">{tr("正在读取本地副本…")}</p>}
    {!packages.loading && !packages.error && !packages.data?.length && <p className="muted">{tr("尚未关联本地副本。导入后可以浏览多层目录、播放音轨和查看附件。")}</p>}
    {selected && <>
      <label className="package-selection">{tr("选择本地副本")}<select aria-label={tr("选择本地副本")} value={selected.packageId}
        onChange={(event) => { setSelectedId(event.target.value); setAttachment(null); }}>
        {packages.data?.map((item) => <option value={item.packageId} key={item.packageId}>{tr(packageKindName(item.kind))} · {item.name} · {item.relativePath}</option>)}
      </select></label>
      <div className="package-section-heading"><span className="work-type">{tr(packageKindName(selected.kind))}</span>
        <button disabled={!editable} onClick={() => setImporting({ kind: selected.kind, selection: {
          kind: selected.kind, providerInstanceId: selected.providerInstanceId, rootId: selected.rootId, path: selected.relativePath,
        } })}>{tr("重新导入")}</button></div>
      <p className="muted">{tr("目录：{0}。请选择具体版本目录播放，避免混入不同编码或内容版本。", { 0: selected.relativePath })}</p>
      <PackageTree key={`${selected.packageId}:${selected.revision}`} value={selected} attachment={setAttachment} />
    </>}
    {importing && <PackageImport api={api} workId={workId} initialKind={importing.kind} initialSelection={importing.selection}
      close={() => setImporting(null)} refresh={packages.reload}
      saved={(value) => { setImporting(null); setSelectedId(value.packageId); packages.reload(); }} />}
    {selected && attachment && <PackageAttachment api={api} packageId={selected.packageId} node={attachment} close={() => setAttachment(null)} />}
  </section>;
}
