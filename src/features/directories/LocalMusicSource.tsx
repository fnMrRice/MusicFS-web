import { DirectoriesApi, type ManagedInstance } from "../../api/directories";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import "./directories.css";

export function LocalMusicSource({ instance, name, manage }: {
  instance: ManagedInstance;
  name: string;
  manage: () => void;
}) {
  const s = useServices();
  const config = useResource("settings-local-directories-true", (signal) => new DirectoriesApi(s.client, instance.instanceId).configuration(signal));
  return <section className="local-music-source" aria-label={name}>
    <div className="directory-actions"><h4>{name}</h4><button onClick={manage}>{tr("管理目录")}</button></div>
    <ErrorNotice error={config.error} retry={config.reload} />
    {config.loading && <p className="muted">{tr("正在读取目录…")}</p>}
    {config.data && (config.data.roots.length > 0
      ? <ul className="directory-saved-list" aria-label={tr("已选音乐目录")}>
        {config.data.roots.map((root) => <li key={root.id}>{root.name}</li>)}
      </ul> : <p className="muted">{tr("暂无已选择目录")}</p>)}
  </section>;
}
