import { useState, type CSSProperties } from "react";
import { version as webVersion } from "../../package.json";
import { tr, useLocale } from "../i18n";
import { useServices, useStore } from "../app/services";
import { LanguageSelect } from "../i18n/LanguageSelect";
import { MusicSources } from "./MusicSources";
import { AlbumAutoSettings } from "./scrapers/AlbumAutoSettings";
import { PluginStatus } from "./PluginStatus";
import { DSPSettings } from "./dsp/DSPSettings";
import { VolumeSlider } from "../player/VolumeControl";
import "./playback-settings.css";
import { settingsSections, useSettingsNavigation } from "./useSettingsNavigation";
import "./settings-navigation.css";

export function Settings() {
  useLocale();
  const s = useServices();
  const auth = useStore(s.auth);
  const { page, navigation, active, select } = useSettingsNavigation();

  return (
    <section className="settings-page" ref={page} aria-label={tr("设置")}>
      <nav
        className="tabs settings-tabs settings-navigation"
        aria-label={tr("设置分类")}
        ref={navigation}
      >
        {settingsSections.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-controls={`settings-panel-${tab.id}`}
            aria-current={active === tab.id ? "location" : undefined}
            className={active === tab.id ? "active" : undefined}
            onClick={(event) => select(tab.id, event.detail === 0)}
          >
            {tr(tab.label)}
          </button>
        ))}
      </nav>
      {settingsSections.map((tab) => (
        <section
          key={tab.id}
          className="settings-section"
          id={`settings-panel-${tab.id}`}
          aria-labelledby={`settings-heading-${tab.id}`}
          tabIndex={-1}
        >
          <h2 id={`settings-heading-${tab.id}`} className="settings-section-title">{tr(tab.label)}</h2>
          {tab.id === "sources" && <><MusicSources /><AlbumAutoSettings /></>}
          {tab.id === "plugins" && (
            auth.session?.user.role === "admin" ? <PluginStatus />
              : <div className="settings-card">
                <p className="muted">{tr("插件管理仅对管理员开放。")}</p>
              </div>
          )}
          {tab.id === "playback" && <PlaybackSettings />}
          {tab.id === "dsp" && <DSPSettings />}
          {tab.id === "appearance" && <AppearanceSettings />}
          {tab.id === "user" && <UserSettings />}
          {tab.id === "about" && <AboutSettings />}
        </section>
      ))}
    </section>
  );
}

function AppearanceSettings() {
  const s = useServices();
  const prefs = useStore(s.preferences);
  return (
      <div className="settings-card appearance-language">
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
        <LanguageSelect />
        <p className="muted">
          {tr("语言偏好保存在当前浏览器，对登录页和所有账号生效。")}
        </p>
      </div>
  );
}

function UserSettings() {
  const s = useServices();
  const auth = useStore(s.auth);
  return (
      <div className="settings-card settings-user">
        <dl>
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
  );
}

function AboutSettings() {
  const s = useServices();
  const auth = useStore(s.auth);
  return (
      <div className="settings-card settings-about">
        <dl>
          <div>
            <dt>{tr("音乐服务")}</dt>
            <dd>{window.location.origin}</dd>
          </div>
          <div>
            <dt>{tr("服务端版本")}</dt>
            <dd>{auth.ready?.serverVersion}</dd>
          </div>
          <div>
            <dt>{tr("Web 版本")}</dt>
            <dd>{webVersion}</dd>
          </div>
          <div>
            <dt>{tr("实例")}</dt>
            <dd>{auth.ready?.instanceId}</dd>
          </div>
          <div>
            <dt>{tr("协议")}</dt>
            <dd>MusicFS API v{auth.ready?.apiVersion}</dd>
          </div>
        </dl>
      </div>
  );
}

function PlaybackSettings() {
  const s = useServices();
  const prefs = useStore(s.preferences);
  const { supported } = useStore(s.localDSP);
  const [fadeDraft, setFadeDraft] = useState<string | null>(null);
  return (
    <div className="settings-card playback-settings">
      <h3>{tr("播放")}</h3>
      <label className="playback-setting-row playback-volume-row" style={{ "--playback-volume": `${Math.round(prefs.volume * 100)}%` } as CSSProperties}>
        <span className="playback-setting-label">{tr("音量")}</span>
        <VolumeSlider label={tr("音量")} />
      </label>
      <label className="playback-setting-row playback-setting-divider">
        <span className="playback-setting-copy">
          <span className="playback-setting-label">{tr("强制服务端转码")}</span>
          <span className="playback-setting-note">{tr("下一首生效")}</span>
        </span>
        <input
          className="playback-switch"
          type="checkbox"
          aria-label={tr("强制服务端转码（下一首生效）")}
          checked={prefs.processing}
          onChange={(e) => s.preference({ processing: e.target.checked })}
        />
      </label>
      <div className="playback-setting-divider">
        <label className="playback-setting-row">
          <span className="playback-setting-label">{tr("切歌淡出淡入")}</span>
          <input
            className="playback-switch"
            type="checkbox"
            aria-label={tr("切歌淡出淡入")}
            checked={prefs.fadeEnabled}
            disabled={!supported}
            onChange={(event) => s.preference({ fadeEnabled: event.target.checked })}
          />
        </label>
        {prefs.fadeEnabled && <div className="playback-duration">
          <label className="playback-duration-label">
            <span>{tr("淡出淡入时长（毫秒）")}</span>
            <input
              aria-label={tr("淡出淡入时长（毫秒）")}
              aria-describedby="playback-fade-help"
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
          <p className="muted" id="playback-fade-help">{tr("100–2000 毫秒，默认 300 毫秒。此时长分别用于淡出和淡入。")}</p>
        </div>}
      </div>
      <label className="playback-setting-row playback-setting-divider">
        <span className="playback-setting-label">{tr("自动音量平衡")}</span>
        <input
          className="playback-switch"
          type="checkbox"
          aria-label={tr("自动音量平衡")}
          checked={prefs.autoVolume}
          disabled={!supported}
          onChange={(event) => s.preference({ autoVolume: event.target.checked })}
        />
      </label>
      {!supported && <p className="muted" role="status">{tr("此浏览器不支持淡出淡入和自动音量平衡，设置会保留。")}</p>}
    </div>
  );
}
