import { useEffect, useMemo, useRef } from "react";
import { DirectoriesApi, type ImportDefaults, type ManagedInstance } from "../../api/directories";
import { useServices, useStore } from "../../app/services";
import { capabilityResources } from "../../app/capability-resources";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { DirectoryTree } from "./DirectoryTree";
import { RecursionSettings } from "./RecursionSettings";
import { DirectorySettingsState } from "./state";
import "./directories.css";

export type DirectoryAction = { type: "add" } | { type: "edit" | "remove"; rootId: string };

export function LocalDirectories({ instance, action = { type: "add" }, close }: {
  instance: ManagedInstance; action?: DirectoryAction; close: () => void;
}) {
  useLocale();
  const s = useServices();
  const auth = useStore(s.auth);
  const api = useMemo(() => new DirectoriesApi(s.client, instance.instanceId), [s, instance.instanceId]);
  const state = useMemo(() => {
    const key = `musicfs:${encodeURIComponent(auth.ready?.instanceId ?? "")}:${encodeURIComponent(auth.session!.user.id)}:directories:${encodeURIComponent(instance.instanceId)}`;
    return new DirectorySettingsState(api, {
      get() { try { return sessionStorage.getItem(key); } catch { return null; } },
      set(id) { try { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); } catch { /* Keep progress in memory. */ } },
    }, action.type === "remove" ? undefined : (operation) => s.scanMusicAfterDirectoryOperation(instance.instanceId, operation));
  }, [api, auth.ready?.instanceId, auth.session?.user.id, instance.instanceId, action.type]);
  const value = useStore(state);
  const applied = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return state.start(controller.signal); });
    return () => controller.abort();
  }, [state]);
  useEffect(() => {
    if (value.busy || value.error || !["applying", "draining"].includes(value.operation?.status ?? "")) return;
    const timer = setTimeout(() => void state.resume(), 1000);
    return () => clearTimeout(timer);
  }, [state, value.operation, value.busy, value.error]);
  useEffect(() => {
    if (value.saved && !applied.current) {
      applied.current = true;
      capabilityResources.invalidate();
      close();
    }
  }, [value.saved]);
  const locked = state.locked;
  const root = action.type === "add" ? null : value.roots.find((item) => item.id === action.rootId)
    ?? (action.type === "remove" ? state.savedRoot(action.rootId) : undefined);
  const options = action.type === "add" ? value.additionOptions : root?.importDefaults ?? value.importDefaults;
  const disabled = locked || value.conflict;
  const submitDisabled = disabled || !value.loaded || (action.type === "add" ? !state.additions.length
    : action.type === "edit" ? !root?.name.trim() || !state.dirty : !root);
  function changeOptions(next: ImportDefaults) {
    if (action.type === "add") state.editAdditions(next);
    else if (action.type === "edit") state.editRoot(action.rootId, { importDefaults: next });
  }
  function submit() {
    if (submitDisabled) return;
    if (action.type === "remove") state.removeRoot(action.rootId);
    else if (action.type === "edit" && root) state.editRoot(root.id, { name: root.name.trim() });
    void state.save();
  }
  return <Modal title={tr(action.type === "add" ? "添加本地目录" : action.type === "edit" ? "编辑目录配置" : "删除本地目录")}
    close={() => { if (!locked) close(); }}>
    <form className="directory-manager" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {action.type === "add" && <p className="muted">{tr("只能选择服务端允许访问的目录或其子目录。这里显示的是服务端的文件夹。")}</p>}
      <ErrorNotice error={value.error} />
      {value.conflict && <button type="button" disabled={value.busy} onClick={() => void state.reload()}>{tr("重新读取配置并放弃未保存选择")}</button>}
      {!value.conflict && value.error && <button type="button" disabled={value.busy} onClick={() => void (locked ? state.resume() : state.reload())}>
        {tr(locked ? "继续确认保存结果" : "重新读取目录配置")}</button>}
      {value.operation && ["applying", "draining"].includes(value.operation.status) && <p role="status">{tr(
        value.operation.status === "draining" ? "正在等待当前播放结束，然后应用目录设置…" : "正在应用目录设置…",
      )}</p>}
      {value.busy && !value.operation && <p role="status">{tr("正在读取或保存目录配置…")}</p>}
      {value.loaded && action.type !== "add" && !root && !value.operation &&
        <p role="alert">{tr("此目录已被删除，请关闭后重新选择。")}</p>}
      {value.loaded && action.type === "add" && <>
        <h3 className="directory-section-title">{tr("允许访问的目录")}</h3>
        <DirectoryTree key={value.revision} api={api} roots={value.roots} disabled={disabled} savedRootIds={state.savedRootIds}
          toggle={(item) => state.toggleAddition(item)} />
        <ul className="directory-selected-summary" aria-label={tr("待添加的目录")}>
          {state.additions.map((item) => <li key={item.id}><span>{item.name}</span>
            <button type="button" disabled={disabled} aria-label={tr("移除目录 {0}", { 0: item.name })}
              onClick={() => state.removeRoot(item.id)}>−</button></li>)}
        </ul>
      </>}
      {value.loaded && action.type === "edit" && root && <label>{tr("目录名称")}
        <input value={root.name} required disabled={disabled} onChange={(event) => state.editRoot(root.id, { name: event.target.value })} />
      </label>}
      {value.loaded && action.type === "remove" && root && <>
        <p>{tr("删除已添加的目录“{0}”？", { 0: root.name })}</p>
        <p className="muted">{tr("仅移除此音乐导入目录，磁盘文件和已有曲库记录会保留，允许访问的目录不受影响。")}</p>
      </>}
      {value.loaded && action.type !== "remove" && (action.type === "add" || root) && <>
        {value.rootImportDefaultsSupported ? <RecursionSettings key={value.revision} value={options} disabled={disabled}
          change={(recursive, maxDepth) => changeOptions({ ...options, recursive, maxDepth: recursive ? maxDepth : 0 })}
          advanced={(advanced) => changeOptions({ ...options, ...advanced })} />
          : <p className="muted">{tr("此服务端暂不支持单独配置目录查找设置。")}</p>}
        {value.rootImportDefaultsSupported && <p className="muted">{tr(action.type === "add"
          ? "查找设置仅应用于本次添加的目录。保存后将自动扫描音乐。"
          : "查找设置仅应用于此目录，不会修改其他目录。保存后将自动扫描音乐。")}</p>}
      </>}
      <div className="directory-actions directory-modal-actions">
        <button type="button" disabled={locked} onClick={close}>{tr("取消")}</button>
        <button type="submit" className="primary" disabled={submitDisabled}>{tr(action.type === "add" ? "添加所选目录"
          : action.type === "remove" ? "删除" : "保存")}</button>
      </div>
    </form>
  </Modal>;
}
