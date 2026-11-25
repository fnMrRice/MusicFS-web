import { useId, useState } from "react";
import { useServices } from "../app/services";
import { useResource } from "../components/query";
import { ErrorNotice, Icon } from "../components/ui";
import { Tooltip } from "../components/Tooltip";
import { Modal } from "../components/Modal";
import { tr, useLocale } from "../i18n";
import type { ManagedPlugin, PluginSnapshot } from "../api/directories";
import { pluginName } from "../components/source-name";
import { matchesPlugin, pluginPurposes, pluginPurposeLabel } from "./plugin-filters";
import { PluginListEntry } from "./PluginListEntry";
import { PluginSettings } from "./plugin-settings/PluginSettings";
import type { SettingsSources } from "./MusicSources";
import "./plugin-status.css";

export default function PluginStatus({ plugins: ownPlugins, online }: SettingsSources) {
  const { locale } = useLocale();
  const s = useServices();
  const [allUsers, setAllUsers] = useState(false);
  const [query, setQuery] = useState("");
  const [purposes, setPurposes] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [configuring, setConfiguring] = useState<ManagedPlugin | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const typeLabelId = useId();
  const typeHelp = tr("可多选；按住 Shift 点击可仅选择该类型；未选择时显示全部。");
  const allPlugins = useResource(allUsers ? "settings-plugins-true" : "", (signal) => allUsers
    ? s.client.request<PluginSnapshot>("/admin/plugins?allUsers=true", { signal })
    : Promise.resolve(null));
  const plugins = allUsers ? allPlugins : ownPlugins;
  const items = plugins.data?.items ?? [];
  const purposeOptions = [...new Set([...items.flatMap(pluginPurposes), ...purposes])];
  const filtered = items.filter((plugin) => matchesPlugin(plugin, purposes, query));
  function reload() { plugins.reload(); online.reload(); }
  function toggleExpanded(pluginId: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(pluginId)) next.delete(pluginId); else next.add(pluginId);
      return next;
    });
  }
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
        <input type="search" aria-label={tr("按 ID 或名称筛选插件")}
          placeholder={tr("按 ID 或名称筛选插件")} value={query}
          onChange={(event) => setQuery(event.target.value)} />
        <button aria-label={tr("刷新插件列表")} title={tr("刷新插件列表")}
          disabled={plugins.loading || online.loading} onClick={reload}>
          <Icon name="refresh" size={18} />
          <span>{tr("刷新")}</span>
        </button>
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
      <label className="check-label plugin-scope">
        <input type="checkbox" checked={allUsers} onChange={(event) => setAllUsers(event.target.checked)} />
        {tr("显示所有用户实例")}
      </label>
      <ErrorNotice error={plugins.error} retry={plugins.reload} />
      <ErrorNotice error={online.error} retry={online.reload} />
      {plugins.data?.restartRequired && <p>{tr("配置变更需要重启服务端后生效。")}</p>}
      {plugins.loading && <p className="muted" role="status">{tr("正在读取插件…")}</p>}
      <ul className="plugin-list" aria-label={tr("插件列表")}>
        {filtered.map((plugin) => <PluginListEntry key={plugin.pluginId} plugin={plugin} locale={locale}
          onlineInstances={online.data} expanded={expanded.has(plugin.pluginId)} onToggle={() => toggleExpanded(plugin.pluginId)}
          onConfigure={() => { setConfigBusy(false); setConfiguring(plugin); }} />)}
      </ul>
      {plugins.data?.items.length === 0 && <p>{tr("未发现已安装插件。")}</p>}
      {items.length > 0 && filtered.length === 0 && <p role="status">{tr("没有符合筛选条件的插件。")}</p>}
      {configuring && <Modal title={tr("配置 {0}", { 0: pluginName(configuring.plugin, locale) })}
        close={() => { if (!configBusy) setConfiguring(null); }}>
        <div className="plugin-configuration">
          <PluginSettings key={configuring.pluginId} pluginId={configuring.pluginId} busyChanged={setConfigBusy}
            cancel={() => { if (!configBusy) setConfiguring(null); }} />
        </div>
      </Modal>}
    </div>
  );
}
