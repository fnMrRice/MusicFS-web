import { useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { tr, useLocale } from "../i18n";
import { useServices, useStore } from "../app/services";
import { LanguageSelect } from "../i18n/LanguageSelect";
import { MusicSources } from "./MusicSources";
import { PluginStatus } from "./PluginStatus";
import { DSPSettings } from "./dsp/DSPSettings";

const tabs = [
  { id: "sources", label: "音乐源" },
  { id: "plugins", label: "插件管理" },
  { id: "playback", label: "播放配置" },
  { id: "dsp", label: "DSP 配置" },
  { id: "other", label: "其他配置" },
] as const;
type SettingsTab = (typeof tabs)[number]["id"];

export function Settings() {
  useLocale();
  const s = useServices();
  const auth = useStore(s.auth);
  const [query, setQuery] = useSearchParams();
  const active = query.has("directories") ? "sources"
    : tabs.find((tab) => tab.id === query.get("tab"))?.id ?? "sources";
  const [focused, setFocused] = useState<SettingsTab | null>(null);
  const tablist = useRef<HTMLDivElement>(null);

  function select(id: SettingsTab) {
    const next = new URLSearchParams(query);
    next.set("tab", id);
    next.delete("directories");
    setFocused(id);
    setQuery(next, { replace: true });
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = (index + 1) % tabs.length; break;
      case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
      case "Home": next = 0; break;
      case "End": next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    tablist.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }

  return (
    <section className="settings-page">
      <p className="eyebrow">{tr("MAKE YOURSELF AT HOME")}</p>
      <h2>{tr("你的聆听偏好")}</h2>
      <div
        className="tabs settings-tabs"
        role="tablist"
        aria-label={tr("设置分类")}
        ref={tablist}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
        }}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`settings-tab-${tab.id}`}
            aria-controls={`settings-panel-${tab.id}`}
            aria-selected={active === tab.id}
            tabIndex={(focused ?? active) === tab.id ? 0 : -1}
            className={active === tab.id ? "active" : undefined}
            onFocus={() => setFocused(tab.id)}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => moveFocus(event, index)}
          >
            {tr(tab.label)}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`settings-panel-${tab.id}`}
          aria-labelledby={`settings-tab-${tab.id}`}
          hidden={active !== tab.id}
          tabIndex={0}
        >
          {active === tab.id && <>
            {tab.id === "sources" && <MusicSources />}
            {tab.id === "plugins" && (
              auth.session?.user.role === "admin" ? <PluginStatus />
                : <div className="settings-card">
                  <h3>{tr("插件管理")}</h3>
                  <p className="muted">{tr("插件管理仅对管理员开放。")}</p>
                </div>
            )}
            {tab.id === "playback" && <PlaybackSettings />}
            {tab.id === "dsp" && <DSPSettings />}
            {tab.id === "other" && <OtherSettings />}
          </>}
        </div>
      ))}
    </section>
  );
}

function OtherSettings() {
  const s = useServices();
  const auth = useStore(s.auth);
  const prefs = useStore(s.preferences);
  return (
    <>
      <div className="settings-card">
        <LanguageSelect />
        <p className="muted">
          {tr("语言偏好保存在当前浏览器，对登录页和所有账号生效。")}
        </p>
      </div>
      <div className="settings-card">
        <h3>{tr("连接与账号")}</h3>
        <dl>
          <div>
            <dt>{tr("音乐服务")}</dt>
            <dd>{window.location.origin}</dd>
          </div>
          <div>
            <dt>{tr("实例")}</dt>
            <dd>{auth.ready?.instanceId}</dd>
          </div>
          <div>
            <dt>{tr("协议")}</dt>
            <dd>MusicFS API v{auth.ready?.apiVersion}</dd>
          </div>
          <div>
            <dt>{tr("当前账号")}</dt>
            <dd>
              {auth.session?.user.id} · {auth.session?.user.role}
            </dd>
          </div>
        </dl>
        <button
          disabled={auth.busy}
          onClick={() => {
            void s.logout();
          }}
        >
          {tr("退出登录")}
        </button>
      </div>
      <div className="settings-card">
        <h3>{tr("外观")}</h3>
        <p className="muted">
          {tr("这些偏好仅保存在当前浏览器，按实例和账号区分。")}
        </p>
        <div className="theme-choices">
          <button
            aria-pressed={prefs.theme === "dark"}
            onClick={() => s.preference({ theme: "dark" })}
          >
            {tr("深夜 · 深色")}
          </button>
          <button
            aria-pressed={prefs.theme === "light"}
            onClick={() => s.preference({ theme: "light" })}
          >
            {tr("晨光 · 浅色")}
          </button>
          <button
            aria-pressed={prefs.theme === "system"}
            onClick={() => s.preference({ theme: "system" })}
          >
            {tr("跟随系统")}
          </button>
        </div>
      </div>
    </>
  );
}

function PlaybackSettings() {
  const s = useServices();
  const prefs = useStore(s.preferences);
  const { supported } = useStore(s.localDSP);
  const [fadeDraft, setFadeDraft] = useState<string | null>(null);
  return (
    <div className="settings-card">
      <h3>{tr("播放")}</h3>
      <label className="check-label">
        <input
          type="checkbox"
          aria-label={tr("强制服务端转码（下一首生效）")}
          checked={prefs.processing}
          onChange={(e) => s.preference({ processing: e.target.checked })}
        />
        {tr("强制服务端转码（下一首生效）")}
      </label>
      <p className="muted">
        {tr(
          "服务端负责格式转换、转码及必要的声道转换；音量与音效在浏览器中实时调整。",
        )}
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          aria-label={tr("切歌淡出淡入")}
          checked={prefs.fadeEnabled}
          disabled={!supported}
          onChange={(event) => s.preference({ fadeEnabled: event.target.checked })}
        />
        {tr("切歌淡出淡入")}
      </label>
      <p className="muted">{tr("切歌时先淡出当前曲目，再淡入新曲目。暂停、停止和定位立即响应。")}</p>
      {prefs.fadeEnabled && <>
        <label>
          {tr("淡出淡入时长（毫秒）")}{" "}
          <input
            aria-label={tr("淡出淡入时长（毫秒）")}
            type="number"
            min={100}
            max={2000}
            step={1}
            disabled={!supported}
            value={fadeDraft ?? prefs.fadeDurationMs}
            onChange={(event) => {
              const value = event.target.value;
              setFadeDraft(value);
              const number = Number(value);
              if (value.trim() && Number.isInteger(number) && number >= 100 && number <= 2000) s.preference({ fadeDurationMs: number });
            }}
            onBlur={() => {
              if (fadeDraft !== null && fadeDraft.trim() && Number.isFinite(Number(fadeDraft))) {
                s.preference({ fadeDurationMs: Math.max(100, Math.min(2000, Math.round(Number(fadeDraft)))) });
              }
              setFadeDraft(null);
            }}
          />
        </label>
        <p className="muted">{tr("100–2000 毫秒，默认 300 毫秒。此时长分别用于淡出和淡入。")}</p>
      </>}
      <label className="check-label">
        <input
          type="checkbox"
          aria-label={tr("自动音量平衡")}
          checked={prefs.autoVolume}
          disabled={!supported}
          onChange={(event) => s.preference({ autoVolume: event.target.checked })}
        />
        {tr("自动音量平衡")}
      </label>
      <p className="muted">{tr("根据播放音量缓慢调整，减小曲目之间的音量差异；静音与安静段落不会被持续放大。")}</p>
      <p className="muted">{tr("音量根据当前播放信号实时估计，刚开始播放时需要逐步调整。")}</p>
      {!supported && <p className="muted" role="status">{tr("此浏览器不支持淡出淡入和自动音量平衡，设置会保留。")}</p>}
      <p className="muted">{tr("这些偏好仅保存在当前浏览器，按实例和账号区分。")}</p>
      <label>
        {tr("默认音量")}{" "}
        <input
          aria-label={tr("默认音量")}
          type="range"
          min="0"
          max="1"
          step=".01"
          value={prefs.volume}
          onChange={(e) => s.preference({ volume: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
