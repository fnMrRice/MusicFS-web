import { useState } from "react";
import { useServices, useStore } from "../app/services";
import { useResource } from "../components/query";
import { ErrorNotice, Icon } from "../components/ui";
import { tr, useLocale } from "../i18n";
import { Link } from "react-router-dom";
import type { PluginSnapshot } from "../api/directories";
import { pluginName, sourceName } from "../components/source-name";
import "./plugin-status.css";
const states: Record<string, string> = {
  disabled: "已禁用",
  pending_configuration: "待配置",
  starting: "正在启动",
  ready: "可用",
  draining: "正在停止",
  failed: "启动或运行失败",
};

export function PluginStatus() {
  const { locale } = useLocale();
  const s = useServices();
  const auth = useStore(s.auth);
  const [allUsers, setAllUsers] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const showAllUsers = auth.session?.user.role === "admin" && allUsers;
  const plugins = useResource(`settings-plugins-${showAllUsers}`, (signal) =>
    s.client.request<PluginSnapshot>(`/admin/plugins${showAllUsers ? "?allUsers=true" : ""}`, { signal }),
  );
  const online = useResource("platform-account-instances", (signal) => s.content.online(signal));
  function reload() { plugins.reload(); online.reload(); }
  return (
    <div className="settings-card plugin-status">
      <div className="plugin-status-heading">
        <h3>{tr("插件状态")}</h3>
        <button className="icon-button" aria-label={tr("刷新插件状态")} title={tr("刷新插件状态")}
          disabled={plugins.loading || online.loading} onClick={reload}>
          <Icon name="refresh" size={18} />
        </button>
      </div>
      <p className="muted">{tr("随包插件在配置齐全且未禁用时自动启动。待配置的插件不会阻止服务运行。")}</p>
      {auth.session?.user.role === "admin" && <label className="check-label plugin-scope">
        <input type="checkbox" checked={allUsers} onChange={(event) => setAllUsers(event.target.checked)} />
        {tr("显示所有用户实例")}
      </label>}
      <ErrorNotice error={plugins.error} retry={plugins.reload} />
      <ErrorNotice error={online.error} retry={online.reload} />
      {plugins.data?.restartRequired && <p>{tr("配置变更需要重启服务端后生效。")}</p>}
      {plugins.loading && <p className="muted" role="status">{tr("正在读取插件…")}</p>}
      <div className="plugin-list">
        {plugins.data?.items.map((p) => (
          <details className="plugin-entry" key={p.pluginId} open={expanded.has(p.pluginId)}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setExpanded((previous) => {
                if (previous.has(p.pluginId) === open) return previous;
                const next = new Set(previous);
                if (open) next.add(p.pluginId); else next.delete(p.pluginId);
                return next;
              });
            }}>
            <summary>
              <Icon name="chevron" size={18} />
              <span className="plugin-information">
                <strong>{pluginName(p.plugin, locale)}</strong>
                <span className="plugin-metadata">
                  <span>{tr("插件 ID")}：<code>{p.pluginId}</code></span>
                  <span>{tr("版本")}：{p.version?.trim() || tr("未知版本")}</span>
                </span>
              </span>
              <span className="plugin-count">{tr("{0} 个实例", { 0: p.instances.length })}</span>
            </summary>
            <div className="plugin-instances">
              <h4>{tr("插件实例")}</h4>
              {p.instances.map((i) => (
                <div className="plugin-instance" key={i.instanceId}>
                  <div className="plugin-instance-heading">
                    <strong>{p.supportsMultipleInstances
                      ? i.accountName?.trim()
                        ? `${pluginName(p.plugin, locale)} · ${i.accountName}`
                        : sourceName({ ...online.data?.find((instance) => instance.instanceId === i.instanceId), plugin: p.plugin }, [], locale)
                      : pluginName(p.plugin, locale)}</strong>
                    <span className="badge">{tr(states[i.runtimeState] ?? "暂不可用")}</span>
                  </div>
                  {i.ownerUserId && <p className="muted">{tr("所属用户：{0}", { 0: i.ownerUserId })}</p>}
                  {i.reason === "RESTART_REQUIRED" && <p className="muted">{tr("等待重启后停用。")}</p>}
                  {i.runtimeState === "pending_configuration" && (
                    <p className="muted">{tr(p.pluginId === "musicfs.plugin.source.localfiles"
                      ? "请从允许访问的目录中选择音乐目录。"
                      : p.pluginId === "musicfs.plugin.decoder.ffmpeg"
                        ? "请在服务端配置可用的 FFmpeg 和 ffprobe 路径。"
                        : "请在服务端完成插件配置。")}</p>
                  )}
                  {p.pluginId === "musicfs.plugin.source.localfiles" && <Link to={`/settings?directories=${encodeURIComponent(i.instanceId)}`}>{tr("管理音乐目录")}</Link>}
                </div>
              ))}
              {p.instances.length === 0 && <p className="muted">{tr("暂无插件实例。")}</p>}
            </div>
          </details>
        ))}
      </div>
      {plugins.data?.items.length === 0 && <p>{tr("未发现已安装插件。")}</p>}
    </div>
  );
}
