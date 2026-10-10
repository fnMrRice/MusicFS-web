import { useServices } from "../app/services";
import { useResource } from "../components/query";
import { ErrorNotice } from "../components/ui";
import { tr, useLocale } from "../i18n";
import { Link } from "react-router-dom";

interface Instance {
  instanceId: string;
  name: string;
  runtimeState: string;
  reason: string | null;
}
interface Snapshot {
  restartRequired: boolean;
  items: { pluginId: string; instances: Instance[] }[];
}
const states: Record<string, string> = {
  disabled: "已禁用",
  pending_configuration: "待配置",
  starting: "正在启动",
  ready: "可用",
  draining: "正在停止",
  failed: "启动或运行失败",
};

export function PluginStatus() {
  useLocale();
  const s = useServices();
  const plugins = useResource("settings-plugins", (signal) =>
    s.client.request<Snapshot>("/admin/plugins", { signal }),
  );
  return (
    <div className="settings-card">
      <h3>{tr("插件状态")}</h3>
      <p className="muted">{tr("随包插件在配置齐全且未禁用时自动启动。待配置的插件不会阻止服务运行。")}</p>
      <ErrorNotice error={plugins.error} retry={plugins.reload} />
      {plugins.data?.restartRequired && <p>{tr("配置变更需要重启服务端后生效。")}</p>}
      {plugins.data?.items.flatMap((p) => p.instances.map((i) => (
        <div className="setting-row" key={i.instanceId}>
          <strong>{i.name || i.instanceId}</strong>
          <span>{tr(states[i.runtimeState] ?? "暂不可用")}</span>
          {i.reason === "RESTART_REQUIRED" && <p className="muted">{tr("等待重启后停用。")}</p>}
          {i.runtimeState === "pending_configuration" && (
            <p className="muted">{tr(p.pluginId === "musicfs.localfiles"
              ? "请从允许访问的目录中选择音乐目录。"
              : "请在服务端配置可用的 FFmpeg 和 ffprobe 路径。")}</p>
          )}
          {p.pluginId === "musicfs.localfiles" && <Link to={`/settings?directories=${encodeURIComponent(i.instanceId)}`}>{tr("管理音乐目录")}</Link>}
        </div>
      )))}
      {plugins.data?.items.length === 0 && <p>{tr("未发现已安装插件。")}</p>}
      <button disabled={plugins.loading} onClick={plugins.reload}>{tr("刷新插件状态")}</button>
    </div>
  );
}
