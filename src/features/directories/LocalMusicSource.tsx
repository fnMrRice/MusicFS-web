import { DirectoriesApi, type ManagedInstance } from "../../api/directories";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import type { DirectoryAction } from "./LocalDirectories";
import "./directories.css";

export function LocalMusicSource({ instance, name, manage }: {
  instance: ManagedInstance;
  name: string;
  manage: (action: DirectoryAction) => void;
}) {
  const s = useServices();
  const config = useResource(`settings-local-directories:${instance.instanceId}`, (signal) => new DirectoriesApi(s.client, instance.instanceId).configuration(signal));
  return <section className="local-music-source" aria-label={name}>
    <div className="directory-actions"><h4>{name}</h4><button onClick={() => manage({ type: "add" })}>{tr("添加本地目录")}</button></div>
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
