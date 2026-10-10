import { useEffect, useMemo } from "react";
import { DirectoriesApi, type ManagedInstance } from "../../api/directories";
import { useServices, useStore } from "../../app/services";
import { capabilityResources } from "../../app/capability-resources";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { DirectoryTree } from "./DirectoryTree";
import { RecursionSettings } from "./RecursionSettings";
import { DirectorySettingsState } from "./state";
import "./directories.css";

export function LocalDirectories({ instance, close }: { instance: ManagedInstance; close: () => void }) {
  useLocale();
  const s = useServices();
  const auth = useStore(s.auth);
  const api = useMemo(() => new DirectoriesApi(s.client, instance.instanceId), [s, instance.instanceId]);
  const state = useMemo(() => {
    const key = `musicfs:${encodeURIComponent(auth.ready?.instanceId ?? "")}:${encodeURIComponent(auth.session!.user.id)}:directories:${encodeURIComponent(instance.instanceId)}`;
    return new DirectorySettingsState(api, {
      get() { try { return sessionStorage.getItem(key); } catch { return null; } },
      set(id) { try { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); } catch { /* Keep progress in memory. */ } },
    });
  }, [api, auth.ready?.instanceId, auth.session?.user.id, instance.instanceId]);
  const value = useStore(state);
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
    if (value.saved) { capabilityResources.invalidate(); close(); }
  }, [value.saved]);
  const locked = state.locked;
  return <Modal title={tr("管理目录")} close={() => { if (!locked) close(); }}>
    <form className="directory-manager" onSubmit={(event) => { event.preventDefault(); void state.save(); }}>
      <p className="muted">{tr("只能选择服务端允许访问的目录或其子目录。这里显示的是服务端的文件夹。")}</p>
      <ErrorNotice error={value.error} />
      {value.conflict && <button type="button" disabled={value.busy} onClick={() => void state.reload()}>{tr("重新读取配置并放弃未保存选择")}</button>}
      {!value.conflict && value.error && <button type="button" disabled={value.busy} onClick={() => void (locked ? state.resume() : state.reload())}>
        {tr(locked ? "继续确认保存结果" : "重新读取目录配置")}</button>}
      {value.operation && ["applying", "draining"].includes(value.operation.status) && <p role="status">{tr(
        value.operation.status === "draining" ? "正在等待当前播放结束，然后应用目录设置…" : "正在应用目录设置…",
      )}</p>}
      {value.busy && !value.operation && <p role="status">{tr("正在读取或保存目录配置…")}</p>}
      {value.loaded && <>
        <DirectoryTree key={value.revision} api={api} roots={value.roots} disabled={locked || value.conflict}
          toggle={(item) => state.toggle(item)} />
        <ul className="directory-selected-summary" aria-label={tr("已选音乐目录")}>
          {value.roots.map((root) => <li key={root.id}><span>{root.name}</span>
            <button type="button" disabled={locked || value.conflict} aria-label={tr("移除目录 {0}", { 0: root.name })}
              onClick={() => state.edit(value.roots.filter((item) => item.id !== root.id))}>×</button></li>)}
        </ul>
        <RecursionSettings key={value.revision} value={value.importDefaults} disabled={locked || value.conflict}
          change={(recursive, maxDepth) => state.editRecursion(recursive, maxDepth)} advanced={(options) => state.editAdvanced(options)} />
      </>}
      <div className="directory-actions directory-modal-actions">
        <button type="button" disabled={locked} onClick={close}>{tr("取消")}</button>
        <button type="submit" className="primary" disabled={locked || !value.loaded || !state.dirty || value.conflict}>{tr("保存")}</button>
      </div>
    </form>
  </Modal>;
}
