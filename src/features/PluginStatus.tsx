import { useId, useState } from "react";
import { useServices, useStore } from "../app/services";
import { useResource } from "../components/query";
import { ErrorNotice, Icon } from "../components/ui";
import { Tooltip } from "../components/Tooltip";
import { tr, useLocale } from "../i18n";
import { Link } from "react-router-dom";
import type { PluginDisplayCount, PluginSnapshot } from "../api/directories";
import { localizedPluginText, pluginName, sourceName } from "../components/source-name";
import { matchesPlugin, pluginPurposes, pluginPurposeLabel } from "./plugin-filters";
import { InfrastructurePluginBadges, InfrastructurePluginDetails } from "./InfrastructurePlugin";
import "./plugin-status.css";
import { PluginSettings } from "./plugin-settings/PluginSettings";
const states: Record<string, string> = {
  disabled: "已禁用",
  pending_configuration: "待配置",
  starting: "正在启动",
  ready: "可用",
  draining: "正在停止",
  failed: "启动或运行失败",
};

function PluginCount({ count, locale }: { count?: PluginDisplayCount; locale: string }) {
  if (!count || !Number.isSafeInteger(count.value) || count.value < 0 ||
    typeof count.unit !== "string" || !count.unit.trim()) return null;
  const unit = localizedPluginText(count.unit, count.localizedUnits, locale);
  return <span className="plugin-count">{`${count.value} ${unit}`}</span>;
}

export function PluginStatus() {
  const { locale } = useLocale();
  const s = useServices();
  const auth = useStore(s.auth);
  const [allUsers, setAllUsers] = useState(false);
  const [query, setQuery] = useState("");
  const [purposes, setPurposes] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const typeLabelId = useId();
  const typeHelp = tr("可多选；按住 Shift 点击可仅选择该类型；未选择时显示全部。");
  const showAllUsers = auth.session?.user.role === "admin" && allUsers;
  const plugins = useResource(`settings-plugins-${showAllUsers}`, (signal) =>
    s.client.request<PluginSnapshot>(`/admin/plugins${showAllUsers ? "?allUsers=true" : ""}`, { signal }),
  );
  const online = useResource("platform-account-instances", (signal) => s.content.online(signal));
  const items = plugins.data?.items ?? [];
  const purposeOptions = [...new Set([...items.flatMap(pluginPurposes), ...purposes])];
  const filtered = items.filter((plugin) => matchesPlugin(plugin, purposes, query));
  function reload() { plugins.reload(); online.reload(); }
  function togglePurpose(purpose: string, exclusive: boolean) {
    setPurposes((previous) => {
      if (exclusive) return new Set([purpose]);
      const next = new Set(previous);
      if (next.has(purpose)) next.delete(purpose); else next.add(purpose);
      return next;
    });
  }
  return (
    <div className="settings-card plugin-status">
      <div className="plugin-status-heading">
        <h3>{tr("插件列表")}</h3>
        <button className="icon-button" aria-label={tr("刷新插件列表")} title={tr("刷新插件列表")}
          disabled={plugins.loading || online.loading} onClick={reload}>
          <Icon name="refresh" size={18} />
        </button>
        <input type="search" aria-label={tr("按 ID 或名称筛选插件")}
          placeholder={tr("按 ID 或名称筛选插件")} value={query}
          onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="plugin-filters">
        <fieldset className="plugin-type-filter" aria-labelledby={typeLabelId}>
          <legend><span className="plugin-type-legend">
            <span id={typeLabelId}>{tr("插件类型")}</span>
            <Tooltip label={typeHelp}>
              <button type="button" className="plugin-type-help" aria-label={tr("插件类型筛选说明")}
                aria-description={typeHelp}><span aria-hidden="true">?</span></button>
            </Tooltip>
          </span></legend>
          <div className="plugin-type-options">
            <button type="button" aria-pressed={purposes.size === 0} onClick={() => setPurposes(new Set())}>
              {tr("全部")}
            </button>
            {purposeOptions.map((purpose) => <label className="check-label" key={purpose} onClick={(event) => {
              if (!event.shiftKey || event.target === event.currentTarget.control) return;
              // 直接处理标签上的快捷单选，避免依赖浏览器转发点击时保留修饰键。
              event.preventDefault();
              event.currentTarget.control?.focus();
              togglePurpose(purpose, true);
            }}>
              <input type="checkbox" checked={purposes.has(purpose)} onChange={(event) =>
                togglePurpose(purpose, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey)} />
              {pluginPurposeLabel(purpose)}
            </label>)}
          </div>
        </fieldset>
      </div>
      {auth.session?.user.role === "admin" && <label className="check-label plugin-scope">
        <input type="checkbox" checked={allUsers} onChange={(event) => setAllUsers(event.target.checked)} />
        {tr("显示所有用户实例")}
      </label>}
      <ErrorNotice error={plugins.error} retry={plugins.reload} />
      <ErrorNotice error={online.error} retry={online.reload} />
      {plugins.data?.restartRequired && <p>{tr("配置变更需要重启服务端后生效。")}</p>}
      {plugins.loading && <p className="muted" role="status">{tr("正在读取插件…")}</p>}
      <div className="plugin-list">
        {filtered.map((p) => (
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
                <InfrastructurePluginBadges plugin={p} />
                <span className="plugin-purposes">
                  <span>{tr("用途")}：</span>
                  {pluginPurposes(p).map((purpose) => <span className="badge" key={purpose}>{pluginPurposeLabel(purpose)}</span>)}
                </span>
                <span className="plugin-metadata">
                  <span>{tr("插件 ID")}：<code>{p.pluginId}</code></span>
                  <span>{tr("版本")}：{p.version?.trim() || tr("未知版本")}</span>
                </span>
              </span>
              <PluginCount count={p.displayCount} locale={locale} />
            </summary>
            {p.storage || p.dsp || p.builtin ? <InfrastructurePluginDetails plugin={p} /> : <div className="plugin-instances">
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
            </div>}
            {p.settingsAvailable && expanded.has(p.pluginId) && <PluginSettings pluginId={p.pluginId} />}
          </details>
        ))}
      </div>
      {plugins.data?.items.length === 0 && <p>{tr("未发现已安装插件。")}</p>}
      {items.length > 0 && filtered.length === 0 && <p role="status">{tr("没有符合筛选条件的插件。")}</p>}
    </div>
  );
}
