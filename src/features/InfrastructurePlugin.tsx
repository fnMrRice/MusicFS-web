import type { ManagedPlugin, PluginDSP, PluginStorage } from "../api/directories";
import { tr } from "../i18n";

const chainStates: Record<PluginDSP["chainState"], string> = {
  disabled: "已禁用",
  not_configured: "未配置",
  not_in_chain: "已配置，未入链",
  in_chain: "已加入处理链",
};
const storageStates: Record<PluginStorage["runtimeState"], string> = {
  ready: "可用",
  unavailable: "不可用",
  unknown: "未知",
};
const modeLabel = (mode: "builtin" | "process") => tr(mode === "builtin" ? "服务端内置" : "独立进程");

export function InfrastructurePluginBadges({ plugin }: { plugin: ManagedPlugin }) {
  const execution = plugin.builtin || plugin.storage ? undefined : plugin.execution;
  if (!plugin.required && !execution) return null;
  return <span className="plugin-infrastructure-badges">
    {plugin.required && <span className="badge">{tr("必需")}</span>}
    {execution && <span className="badge">{modeLabel(execution)}</span>}
  </span>;
}

export function InfrastructurePluginDetails({ plugin }: { plugin: ManagedPlugin }) {
  return <div className="plugin-infrastructure">
    {plugin.builtin && <>
      <dl className="plugin-properties">
        <div><dt>{tr("运行方式")}</dt><dd>{tr("服务端内置")}</dd></div>
        <div><dt>{tr("业务配置")}</dt><dd>{tr(plugin.builtin.configured ? "已配置" : "未配置")}</dd></div>
      </dl>
    </>}
    {plugin.storage && <>
      <p>{tr("数据库为服务端必需组件，不能停用。后端由服务端启动配置选择，修改后需重启服务端。")}</p>
      <dl className="plugin-properties">
        <div><dt>{tr("数据库后端")}</dt><dd>{plugin.storage.backend}</dd></div>
        <div><dt>{tr("运行方式")}</dt><dd>{modeLabel(plugin.storage.mode)}</dd></div>
        <div><dt>{tr("健康状态")}</dt><dd>{tr(storageStates[plugin.storage.runtimeState])}</dd></div>
      </dl>
    </>}
    {plugin.dsp && <>
      <h4>{tr("处理链配置")}</h4>
      <p>{tr(chainStates[plugin.dsp.chainState])}</p>
      <p className="muted">{tr("这里显示此插件在服务端启动配置中的处理链节点及原始位置，不表示当前歌曲正在执行这些处理。修改配置后需重启服务端。")}</p>
      {plugin.dsp.nodes.length > 0 ? <ol className="plugin-dsp-chain" aria-label={tr("处理链节点顺序")}>
        {[...plugin.dsp.nodes].sort((a, b) => a.position - b.position).map((node, index) => <li key={`${node.position}-${index}`} value={node.position}>
          <div className="plugin-dsp-node-heading"><strong>{node.name}</strong><span className="badge">{modeLabel(node.mode)}</span></div>
          <dl className="plugin-properties">
            <div><dt>{tr("节点版本")}</dt><dd>{node.version}</dd></div>
            <div><dt>{tr("参数")}</dt><dd>{Object.keys(node.params).length > 0
              ? <ul className="plugin-dsp-params">{Object.entries(node.params).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) =>
                <li key={name}><code>{name}</code><span>{value}</span></li>)}</ul>
              : tr("无参数")}</dd></div>
          </dl>
        </li>)}
      </ol> : <p className="muted">{tr("此 DSP 尚未加入处理链。")}</p>}
    </>}
  </div>;
}
