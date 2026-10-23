import { DirectoriesApi, type ManagedInstance } from "../../api/directories";
import { useEffect, useMemo } from "react";
import { useServices, useStore } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import type { DirectoryAction } from "./LocalDirectories";
import { LocalScanStatus } from "./LocalScanStatus";
import { useRootStatistics } from "./use-root-statistics";
import { directorySize } from "../../library/root-statistics";
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
  const statistics = useRootStatistics(s.client, instance.instanceId,
    JSON.stringify([auth.ready?.instanceId, auth.session?.user.id]), scan.job);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void state.refreshStatus(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [state]);
  const config = useResource(`settings-local-directories:${instance.instanceId}`, (signal) => new DirectoriesApi(s.client, instance.instanceId).configuration(signal));
  const unavailable = instance.runtimeState !== "ready" || provider && !["available", "online"].includes(provider.availability)
    ? "本地音乐来源尚未就绪，请先在插件设置中启用并检查状态。"
    : provider && !provider.capabilities?.includes("library.scan") ? "当前来源尚不支持此功能。"
    : config.data?.roots.length === 0 ? "请先添加本地音乐目录。" : null;
  return <section className="local-music-source" aria-label={name}>
    <div className="directory-actions"><h4>{name}</h4>
      <button type="button" disabled={scan.checking || scan.busy || scan.pending || !config.data || !!unavailable}
        title={unavailable ? tr(unavailable) : undefined} onClick={() => void state.start()}>
        {tr(scan.checking ? "正在检查扫描状态…" : !scan.refreshing && (scan.pending || scan.busy) ? scan.job ? "正在扫描…" : "正在提交扫描…" : "扫描音乐")}</button>
      <button onClick={() => manage({ type: "add" })}>{tr("添加本地目录")}</button></div>
    <LocalScanStatus value={scan} state={state} unavailable={unavailable} />
    <ErrorNotice error={config.error} retry={config.reload} />
    <div className="directory-statistics-error"><ErrorNotice error={statistics.error} retry={statistics.reload} /></div>
    {config.loading && <p className="muted">{tr("正在读取目录…")}</p>}
    {config.data && (config.data.roots.length > 0
      ? <ul className="directory-saved-list" aria-label={tr("已添加的目录")}>
        {config.data.roots.map((root) => <li key={root.id}>
          <div className="directory-saved-details">
            <span className="directory-saved-name">{root.name}</span>
            <span className="directory-saved-stats" title={tr("按最近成功扫描统计音乐文件，不含歌词和封面。")}>{statistics.data === null
              ? tr(statistics.loading ? "正在读取统计…" : "统计暂不可用")
              : tr("{0} 首 · {1}", { 0: statistics.data.find((item) => item.rootId === root.id)?.trackCount ?? 0,
                1: directorySize(statistics.data.find((item) => item.rootId === root.id)?.sizeBytes ?? 0) })}</span>
          </div>
          <div className="directory-row-actions">
            <button type="button" aria-label={tr("删除目录 {0}", { 0: root.name })} title={tr("删除目录")}
              onClick={() => manage({ type: "remove", rootId: root.id })}>−</button>
            <button type="button" aria-label={tr("编辑目录 {0}", { 0: root.name })}
              onClick={() => manage({ type: "edit", rootId: root.id })}>{tr("编辑")}</button>
            <button type="button" aria-label={tr("刷新目录 {0} 的元数据", { 0: root.name })}
              title={tr(unavailable ?? "重新读取歌曲信息、封面和歌词，保留手动选定的内容。")}
              disabled={scan.checking || scan.busy || scan.pending || !!unavailable} onClick={() => void state.refresh(root.id)}>{tr("刷新")}</button>
          </div>
        </li>)}
      </ul> : <p className="muted">{tr("暂无已添加目录")}</p>)}
  </section>;
}
