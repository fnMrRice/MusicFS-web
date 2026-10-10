import { tr, useLocale } from "../i18n";
import { useServices, useStore } from "../app/services";
import { useResource } from "../components/query";
import { ErrorNotice } from "../components/ui";
import { sourceName } from "../components/source-name";
import { LanguageSelect } from "../i18n/LanguageSelect";
import { PlatformAccounts } from "./accounts/PlatformAccounts";
import { PluginStatus } from "./PluginStatus";
export function Settings() {
  useLocale();
  const s = useServices();
  const auth = useStore(s.auth);
  const prefs = useStore(s.preferences);
  const providers = useResource("settings-providers", (signal) =>
    s.libraryApi.providers(signal),
  );
  return (
    <section className="settings-page">
      <p className="eyebrow">{tr("MAKE YOURSELF AT HOME")}</p>
      <h2>{tr("你的聆听偏好")}</h2>
      <PlatformAccounts />
      {auth.session?.user.role === "admin" && <PluginStatus />}
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
      <div className="settings-card">
        <h3>{tr("播放")}</h3>
        <label className="check-label">
          <input
            type="checkbox"
            aria-label={tr("服务端处理（降低 6 dB，下一首生效）")}
            checked={prefs.processing}
            onChange={(e) => s.preference({ processing: e.target.checked })}
          />
          {tr("请求服务端处理，降低 6 dB（下一首生效）")}
        </label>
        <p className="muted">
          {tr(
            "服务端根据实际插件能力协商输出；播放器会显示最终生效的处理。音量调节在浏览器中完成。",
          )}
        </p>
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
      <div className="settings-card">
        <h3>{tr("音乐来源")}</h3>
        <ErrorNotice error={providers.error} retry={providers.reload} />
        {providers.loading && <p>{tr("正在读取来源…")}</p>}
        {providers.data?.map((p) => (
          <div className="setting-row" key={p.id}>
            <strong>{sourceName(p)}</strong>
            <span className="muted">
              {p.availability === "available" ? tr("可用") : tr("暂不可用")}
            </span>
          </div>
        ))}
        {providers.data?.length === 0 && (
          <p className="muted">{tr("暂无音乐来源")}</p>
        )}
        <p className="muted">{tr("音乐目录、插件与平台账号由服务端管理。")}</p>
      </div>
    </section>
  );
}
