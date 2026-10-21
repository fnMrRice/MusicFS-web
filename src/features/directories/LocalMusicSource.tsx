import { DirectoriesApi, type ManagedInstance } from "../../api/directories";
import { useMemo } from "react";
import { useServices, useStore } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import type { DirectoryAction } from "./LocalDirectories";
import { LocalScanStatus } from "./LocalScanStatus";
import "./directories.css";

export function LocalMusicSource({ instance, name, manage }: {
  instance: ManagedInstance;
  name: string;
  manage: (action: DirectoryAction) => void;
}) {
  const s = useServices();
  const auth = useStore(s.auth);
  const provider = useStore(s.libraryApi.providerInstances).find((item) => item.id === instance.instanceId);
  const state = useMemo(() => s.localScan(instance.instanceId), [s, instance.instanceId, auth.ready?.instanceId, auth.session?.user.id]);
  const scan = useStore(state);
  const config = useResource(`settings-local-directories:${instance.instanceId}`, (signal) => new DirectoriesApi(s.client, instance.instanceId).configuration(signal));
  const unavailable = instance.runtimeState !== "ready" || provider && !["available", "online"].includes(provider.availability)
    ? "本地音乐来源尚未就绪，请先在插件设置中启用并检查状态。"
    : provider && !provider.capabilities?.includes("library.scan") ? "当前来源尚不支持此功能。"
    : config.data?.roots.length === 0 ? "请先添加本地音乐目录。" : null;
  return <section className="local-music-source" aria-label={name}>
    <div className="directory-actions"><h4>{name}</h4>
      <button type="button" disabled={scan.busy || scan.pending || !config.data || !!unavailable}
        title={unavailable ? tr(unavailable) : undefined} onClick={() => void state.start()}>
        {tr(scan.pending || scan.busy ? scan.job ? "正在扫描…" : "正在提交扫描…" : "扫描音乐")}</button>
      <button onClick={() => manage({ type: "add" })}>{tr("添加本地目录")}</button></div>
    <LocalScanStatus value={scan} state={state} unavailable={unavailable} />
    <ErrorNotice error={config.error} retry={config.reload} />
    {config.loading && <p className="muted">{tr("正在读取目录…")}</p>}
    {config.data && (config.data.roots.length > 0
      ? <ul className="directory-saved-list" aria-label={tr("已添加的目录")}>
        {config.data.roots.map((root) => <li key={root.id}>
          <span className="directory-saved-name">{root.name}</span>
          <div className="directory-row-actions">
            <button type="button" aria-label={tr("删除目录 {0}", { 0: root.name })} title={tr("删除目录")}
              onClick={() => manage({ type: "remove", rootId: root.id })}>−</button>
            <button type="button" aria-label={tr("编辑目录 {0}", { 0: root.name })}
              onClick={() => manage({ type: "edit", rootId: root.id })}>{tr("编辑")}</button>
          </div>
        </li>)}
      </ul> : <p className="muted">{tr("暂无已添加目录")}</p>)}
  </section>;
}
