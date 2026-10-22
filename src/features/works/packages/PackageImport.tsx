import { useLayoutEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../../api/client";
import type { PackageKind, PackagePreview, PackageSelection, WorkPackage, WorkPackagesApi } from "../../../api/work-packages";
import { useServices } from "../../../app/services";
import { useResource } from "../../../components/query";
import { Modal } from "../../../components/Modal";
import { ErrorNotice, Icon } from "../../../components/ui";
import { tr, useLocale } from "../../../i18n";
import { PackageTree } from "./PackageTree";
import { packageKindName } from "./tree";

export function PackageImport({ api, workId, initialKind, initialSelection, close, saved, refresh }: {
  api: WorkPackagesApi; workId: string; close: () => void; saved: (value: WorkPackage) => void; refresh: () => void;
  initialKind: PackageKind; initialSelection?: PackageSelection;
}) {
  useLocale();
  const services = useServices();
  const sources = useResource(`package-sources:${workId}`, (signal) => api.sources(signal));
  const [kind, setKind] = useState(initialKind);
  const [providerId, setProviderId] = useState(initialSelection?.providerInstanceId ?? "");
  const [rootId, setRootId] = useState(initialSelection?.rootId ?? "");
  const [path, setPath] = useState(initialSelection?.path ?? ".");
  const source = providerId ? sources.data?.find((item) => item.providerInstanceId === providerId) : sources.data?.[0];
  const root = rootId ? source?.roots.find((item) => item.id === rootId) : source?.roots[0];
  const location = { providerInstanceId: source?.providerInstanceId ?? "", rootId: root?.id ?? "", path };
  const listing = useResource(`package-directories:${workId}:${JSON.stringify(location)}`, (signal) =>
    root ? api.directories(location, signal) : Promise.resolve({ path: ".", directories: [] }));
  const [preview, setPreview] = useState<PackagePreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const pending = useRef<{ previewId: string; key: string } | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; previewRequest.current?.abort(); };
  }, []);
  async function readPreview() {
    if (busyRef.current || uncertain || !root) return;
    busyRef.current = true; setBusy("preview"); setError(null); pending.current = null;
    const controller = new AbortController(); previewRequest.current = controller;
    try {
      const result = await api.preview({ ...location, kind }, controller.signal);
      if (mounted.current) { setPreview(result); setStale(false); }
    }
    catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(null); }
  }
  async function confirm() {
    if (busyRef.current || !preview || stale) return;
    pending.current ??= { previewId: preview.previewId, key: crypto.randomUUID() };
    busyRef.current = true; setBusy("confirm"); setError(null);
    try {
      const result = await api.confirm(pending.current.previewId, pending.current.key);
      services.invalidateLibraries();
      if (mounted.current) saved(result);
    } catch (failure) {
      if (!mounted.current) return;
      const unknown = failure instanceof ApiError && (failure.status === 0 || failure.status >= 500 || failure.code === "INVALID_RESPONSE");
      setUncertain(unknown);
      if (unknown) setError(tr("暂时无法确认导入结果。已锁定本次预览，请重试确认；关闭后请先查看本地副本，避免重复操作。"));
      else if (failure instanceof ApiError && failure.status === 409) {
        setStale(true); pending.current = null;
        setError(tr("目录内容已变化或预览已过期，请重新预览后确认。"));
      } else setError(errorMessage(failure));
    } finally { busyRef.current = false; if (mounted.current) setBusy(null); }
  }
  function leave() { if (!busyRef.current) { close(); if (uncertain) refresh(); } }
  function invalidate() { setPreview(null); setError(null); setStale(false); pending.current = null; }
  return <Modal title={tr("导入本地副本")} close={leave}>
    <div className="package-import">
      <p className="muted">{tr("选择服务端已配置来源中的一个作品目录。预览不会入库；确认后保留目录、音轨和附件关联。")}</p>
      <label className="package-selection">{tr("副本类型")}<select aria-label={tr("副本类型")} value={kind} disabled={!!busy || uncertain}
        onChange={(event) => { if (!busyRef.current && !uncertain) { setKind(event.target.value as PackageKind); invalidate(); } }}>
        <option value="directory">{tr("普通目录")}</option><option value="cd_dump">{tr("CD 抓轨")}</option>
      </select></label>
      {kind === "cd_dump" && <p className="muted">{tr("将手动抓轨或下载的文件夹标记为 CD 抓轨副本；当前按现有文件播放，不执行光盘读取或 CUE 分轨。")}</p>}
      {!preview && <>
        <ErrorNotice error={sources.error} retry={sources.reload} />
        {sources.loading && <p role="status">{tr("正在读取本地来源…")}</p>}
        {!sources.loading && !sources.error && !sources.data?.length && <p>{tr("没有可用的本地来源，请先在音乐源设置中添加目录。")}</p>}
        <fieldset disabled={!!busy} className="package-selectors">
          <label>{tr("本地来源")}<select aria-label={tr("本地来源")} value={source?.providerInstanceId ?? ""}
            onChange={(event) => { setProviderId(event.target.value); setRootId(""); setPath("."); invalidate(); }}>
            {!source && <option value="" disabled>{tr("请选择可用来源")}</option>}
            {sources.data?.map((item) => <option key={item.providerInstanceId} value={item.providerInstanceId}>{item.name}</option>)}
          </select></label>
          <label>{tr("来源根目录")}<select aria-label={tr("来源根目录")} value={root?.id ?? ""}
            onChange={(event) => { setRootId(event.target.value); setPath("."); invalidate(); }}>
            {!root && <option value="" disabled>{tr("请选择可用根目录")}</option>}
            {source?.roots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
        </fieldset>
        {root && <>
          <p className="package-current-path">{tr("当前目录：{0}", { 0: path === "." ? root.name : path })}</p>
          <button type="button" disabled={!!busy || path === "."} onClick={() => setPath(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".")}>{tr("上一级目录")}</button>
          <ErrorNotice error={listing.error} retry={listing.reload} />
          {listing.loading ? <p role="status">{tr("正在读取目录…")}</p> : <ul className="package-directory-picker">
            {listing.data?.directories.map((directory) => <li key={directory.path}><button type="button" disabled={!!busy}
              aria-label={tr("进入目录 {0}", { 0: directory.name })} onClick={() => setPath(directory.path)}><Icon name="folder" />{directory.name}</button></li>)}
            {!listing.error && !listing.data?.directories.length && <li className="muted">{tr("此目录没有子目录，可以直接预览当前目录。")}</li>}
          </ul>}
        </>}
      </>}
      {preview && <>
        <h3>{preview.package.name}</h3>
        <p>{tr("副本类型：{0}", { 0: tr(packageKindName(preview.package.kind)) })}</p>
        {preview.package.revision > 0 && <p className="notice">{tr("此位置已导入，确认后将更新原副本及其类型。")}</p>}
        <p>{tr("{0} 个目录 · {1} 条音轨 · {2} 个附件", { 0: preview.counts.directories, 1: preview.counts.audio, 2: preview.counts.attachments })}</p>
        {preview.warnings.length > 0 && <ul className="notice">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <div className="package-preview-tree"><PackageTree value={preview.package} preview /></div>
      </>}
      <ErrorNotice error={error} />
      {busy && <p role="status">{tr(busy === "preview" ? "正在读取目录并预览本地副本…" : "正在导入并确认结果…")}</p>}
      <div className="work-actions">
        {!preview ? <button className="primary" disabled={!!busy || !root || listing.loading || !!listing.error} onClick={() => void readPreview()}>{tr("预览当前目录")}</button> : <>
          {stale ? <button className="primary" disabled={!!busy} onClick={() => void readPreview()}>{tr("重新预览")}</button> :
            <button className="primary" disabled={!!busy} onClick={() => void confirm()}>{tr(uncertain ? "重试确认导入" : "确认导入")}</button>}
          <button disabled={!!busy || uncertain} onClick={invalidate}>{tr("返回选择目录")}</button>
        </>}
        <button disabled={!!busy} onClick={leave}>{tr(uncertain ? "关闭并刷新查看" : "取消")}</button>
      </div>
    </div>
  </Modal>;
}
