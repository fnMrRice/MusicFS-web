import { useEffect, useMemo, useRef, useState } from "react";
import { DirectoriesApi, type ManagedInstance } from "../../api/directories";
import { useServices, useStore } from "../../app/services";
import { capabilityResources } from "../../app/capability-resources";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { AddDirectory } from "./AddDirectory";
import { AllowedDirectories } from "./AllowedDirectories";
import { DirectorySettingsState } from "./state";
import "./directories.css";

export function LocalDirectories({ instance, close }: { instance: ManagedInstance; close: () => void }) {
  useLocale();
  const s = useServices();
  const auth = useStore(s.auth);
  const panel = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
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
    panel.current?.scrollIntoView({ block: "nearest" });
    return () => controller.abort();
  }, [state]);
  useEffect(() => {
    if (value.busy || value.error || !["applying", "draining"].includes(value.operation?.status ?? "")) return;
    const timer = setTimeout(() => void state.resume(), 1000);
    return () => clearTimeout(timer);
  }, [state, value.operation, value.busy, value.error]);
  useEffect(() => { if (value.saved) capabilityResources.invalidate(); }, [value.saved]);
  const locked = state.locked;
  return <div className="local-directories" ref={panel} aria-label={tr("管理音乐目录")}>
    <div className="directory-actions">
      <h4>{tr("管理音乐目录")} · {instance.name}</h4>
      <button onClick={close}>{tr("收起目录管理")}</button>
    </div>
    <p className="muted">{tr("选择用于音乐导入的目录。保存后不会自动扫描，导入音乐需另行发起扫描。")}</p>
    <ErrorNotice error={value.error} />
    {value.conflict && <button disabled={value.busy} onClick={() => void state.reload()}>{tr("重新读取配置并放弃未保存选择")}</button>}
    {!value.conflict && value.error && <button disabled={value.busy} onClick={() => void (locked ? state.resume() : state.reload())}>
      {tr(locked ? "继续确认保存结果" : "重新读取目录配置")}</button>}
    {value.operation && ["applying", "draining"].includes(value.operation.status) && <p role="status">{tr(
      value.operation.status === "draining" ? "正在等待当前播放结束，然后应用目录设置…" : "正在应用目录设置…",
    )}</p>}
    {value.busy && !value.operation && <p role="status">{tr("正在读取或保存目录配置…")}</p>}
    {value.saved && <p role="status">{tr("音乐目录已保存。")}{" "}
      {value.roots.length === 0 && tr("尚未选择音乐目录，已有曲库记录会保留。")}</p>}
    {value.loaded && <>
      <AllowedDirectories key={value.revision} api={api} />
      <div className="directory-actions">
        <h4>{tr("已选音乐目录")}</h4>
        <button disabled={locked || value.conflict} onClick={() => setAdding(true)}>{tr("添加本地目录")}</button>
      </div>
      {value.roots.length === 0 && <p className="muted">{tr("尚未选择音乐目录，已有曲库记录会保留。")}</p>}
      <ul className="directory-list" aria-label={tr("已选音乐目录")}>
        {value.roots.map((root) => <li key={root.id}>
          <div className="directory-detail"><strong>{root.name}</strong>
            <code>{root.path ?? tr("已保存的目录")}</code></div>
          <button disabled={locked} aria-label={tr("移除目录 {0}", { 0: root.name })}
            onClick={() => state.edit(value.roots.filter((r) => r.id !== root.id))}>{tr("移除目录")}</button>
        </li>)}
      </ul>
      {adding && <AddDirectory key={value.revision} api={api} roots={value.roots} disabled={locked || value.conflict}
        add={(item) => state.select(item)} close={() => setAdding(false)} />}
      <div className="directory-actions directory-save">
        <button className="primary" disabled={locked || !state.dirty && value.operation?.status !== "failed" || value.conflict} onClick={() => void state.save()}>{tr("保存音乐目录")}</button>
        <button disabled={locked || !value.roots.length} onClick={() => state.edit([])}>{tr("清空选择")}</button>
        <button disabled={locked} onClick={() => void state.reload()}>{tr("重新读取目录配置")}</button>
      </div>
    </>}
  </div>;
}
