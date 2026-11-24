import { useId } from "react";
import { Link } from "react-router-dom";
import type { OnlineInstance } from "../api/content";
import type { ManagedPlugin, PluginDisplayCount } from "../api/directories";
import { localizedPluginText, pluginName, sourceName } from "../components/source-name";
import { Icon } from "../components/ui";
import { tr } from "../i18n";
import { InfrastructurePluginBadges, InfrastructurePluginDetails } from "./InfrastructurePlugin";
import { pluginPurposes, pluginPurposeLabel, pluginScrapedFields } from "./plugin-filters";
import { scrapedFieldName } from "./scrapers/fields";

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
  return <span className="plugin-count">{count.value} {unit}</span>;
}

interface PluginEntryProps {
  plugin: ManagedPlugin;
  locale: string;
  onlineInstances: OnlineInstance[] | null;
  expanded: boolean;
  onToggle: () => void;
  onConfigure: () => void;
}

export function PluginListEntry({ plugin, locale, onlineInstances, expanded, onToggle, onConfigure }: PluginEntryProps) {
  const detailsId = useId();
  const name = pluginName(plugin.plugin, locale);
  const version = plugin.version?.trim();
  const fields = pluginScrapedFields(plugin);
  return <li className="plugin-entry">
    <div className="plugin-entry-heading">
      <button type="button" className="plugin-entry-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={onToggle}>
        <Icon name="chevron" size={18} />
        <span className="plugin-entry-summary">
          <span className="plugin-title">
            <strong className="plugin-name">{name}</strong>
            <PluginCount count={plugin.displayCount} locale={locale} />
          </span>
          {version && <span className="plugin-version">{tr("版本：{0}", { 0: version })}</span>}
        </span>
      </button>
      {plugin.settingsAvailable && <button type="button" className="plugin-configure"
        aria-label={tr("配置 {0}", { 0: name })} onClick={onConfigure}>
        <Icon name="settings" size={16} />{tr("配置")}
      </button>}
    </div>
    <div id={detailsId} className="plugin-entry-details" hidden={!expanded}>
      <dl className="plugin-metadata">
        <div className="plugin-purposes">
          <dt>{tr("用途")}</dt>
          <dd>{pluginPurposes(plugin).map((purpose) => <span className="badge" key={purpose}>{pluginPurposeLabel(purpose)}</span>)}</dd>
        </div>
        <div><dt>{tr("插件 ID")}</dt><dd><code>{plugin.pluginId}</code></dd></div>
        {fields.length > 0 && <div>
          <dt>{tr("支持刮削的内容")}</dt>
          <dd>{fields.map((field) => <span key={field}>{scrapedFieldName(field)}</span>)}</dd>
        </div>}
      </dl>
      <InfrastructurePluginBadges plugin={plugin} />
      {plugin.storage || plugin.dsp || plugin.builtin
        ? <InfrastructurePluginDetails plugin={plugin} />
        : <div className="plugin-instances">
          <h4>{tr("插件实例")}</h4>
          {plugin.instances.map((instance) => (
            <div className="plugin-instance" key={instance.instanceId}>
              <div className="plugin-instance-heading">
                <strong>{plugin.supportsMultipleInstances
                  ? instance.accountName?.trim()
                    ? `${name} · ${instance.accountName}`
                    : sourceName({ ...onlineInstances?.find((item) => item.instanceId === instance.instanceId), plugin: plugin.plugin }, [], locale)
                  : name}</strong>
                <span className="badge">{tr(states[instance.runtimeState] ?? "暂不可用")}</span>
              </div>
              {instance.ownerUserId && <p className="muted">{tr("所属用户：{0}", { 0: instance.ownerUserId })}</p>}
              {instance.reason === "RESTART_REQUIRED" && <p className="muted">{tr("等待重启后停用。")}</p>}
              {instance.runtimeState === "pending_configuration" && <p className="muted">{tr(plugin.pluginId === "musicfs.plugin.source.localfiles"
                ? "请从允许访问的目录中选择音乐目录。"
                : plugin.pluginId === "musicfs.plugin.decoder.ffmpeg"
                  ? "请在服务端配置可用的 FFmpeg 和 ffprobe 路径。"
                  : "请在服务端完成插件配置。")}</p>}
              {plugin.pluginId === "musicfs.plugin.source.localfiles" && <Link to={`/settings?directories=${encodeURIComponent(instance.instanceId)}`}>{tr("管理音乐目录")}</Link>}
            </div>
          ))}
          {plugin.instances.length === 0 && <p className="muted">{tr("暂无插件实例。")}</p>}
        </div>}
    </div>
  </li>;
}
