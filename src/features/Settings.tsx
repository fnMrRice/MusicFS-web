import { lazy, Suspense, useState, type CSSProperties } from "react";
import { version as webVersion } from "../../package.json";
import { tr, useLocale } from "../i18n";
import { useServices, useStore } from "../app/services";
import { LanguageSelect } from "../i18n/LanguageSelect";
import { ThemeChoices } from "../components/ThemeChoices";
import { RecommendationOrderSettings } from "./RecommendationOrderSettings";
import { MusicSources } from "./MusicSources";
import { ScraperOrderSettings } from "./scrapers/ScraperOrderSettings";
import { DSPSettings } from "./dsp/DSPSettings";
import { VolumeSlider } from "../player/VolumeControl";
import { OnlineDownloadDirectory } from "./OnlineDownloadDirectory";
import "./playback-settings.css";
import { settingsSections, useSettingsNavigation } from "./useSettingsNavigation";
import "./settings-navigation.css";

const PluginStatus = lazy(() => import("./PluginStatus"));

export default function Settings() {
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
          {tab.id === "sources" && <><MusicSources /><ScraperOrderSettings kind="album" /><ScraperOrderSettings kind="lyrics" /></>}
          {tab.id === "plugins" && (
            auth.session?.user.role === "admin" ? (
              <Suspense fallback={<p className="loading" role="status">{tr("正在加载…")}</p>}>
                <PluginStatus />
              </Suspense>
            ) : (
              <div className="settings-card">
                <p className="muted">{tr("插件管理仅对管理员开放。")}</p>
              </div>
            )
          )}
          {tab.id === "playback" && <><PlaybackSettings /><OnlineDownloadDirectory /></>}
          {tab.id === "dsp" && <DSPSettings />}
          {tab.id === "appearance" && <><AppearanceSettings /><RecommendationOrderSettings /></>}
          {tab.id === "user" && <UserSettings />}
          {tab.id === "about" && <AboutSettings />}
        </section>
      ))}
    </section>
  );
}

function AppearanceSettings() {
  return (
    <div className="settings-card appearance-language">
      <ThemeChoices />
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

const fadeDurations = [["trackMs", "切歌"], ["pauseMs", "暂停"], ["seekMs", "跳转"]] as const;

function FadeDuration({ label, value, disabled, change }: {
  label: string; value: number; disabled: boolean; change: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="fade-duration">
      <span>{tr(label)}</span>
      <input
        aria-label={tr("{action}淡出淡入时长（毫秒）", { action: tr(label) })}
        type="number" min={0} max={2000} step={1} disabled={disabled}
        value={draft ?? value}
        onChange={({ currentTarget }) => {
          setDraft(currentTarget.value);
          if (Number.isInteger(currentTarget.valueAsNumber) && currentTarget.validity.valid) change(currentTarget.valueAsNumber);
        }}
        onBlur={({ currentTarget }) => {
          const number = currentTarget.valueAsNumber;
          if (Number.isFinite(number)) {
            const bounded = Math.max(0, Math.min(2000, Math.round(number)));
            if (bounded !== value) change(bounded);
          }
          setDraft(null);
        }}
      />
    </label>
  );
}

function PlaybackSettings() {
  const s = useServices();
  const prefs = useStore(s.preferences);
  const { supported } = useStore(s.localDSP);
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
      <div className="playback-setting-row playback-setting-divider fade-row">
        <label className="fade-toggle">
          <span className="playback-setting-label">{tr("淡出淡入")}</span>
          <input
            className="playback-switch"
            type="checkbox"
            checked={prefs.fades.enabled}
            disabled={!supported}
            onChange={(event) => s.preference({ fades: { ...s.preferences.value.fades, enabled: event.target.checked } })}
          />
        </label>
        <div className="fade-durations">
          {fadeDurations.map(([field, label]) => (
            <FadeDuration key={field} label={label} value={prefs.fades[field]}
              disabled={!supported || !prefs.fades.enabled}
              change={(value) => s.preference({ fades: { ...s.preferences.value.fades, [field]: value } })}
            />
          ))}
          <span aria-hidden="true">ms</span>
        </div>
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
