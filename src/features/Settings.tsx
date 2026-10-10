import { useServices, useStore } from "../app/services";
import { useResource } from "../components/query";
import { ErrorNotice } from "../components/ui";
import { PlatformAccounts } from "./accounts/PlatformAccounts";
import { PluginStatus } from "./PluginStatus";
export function Settings() {
  const s = useServices();
  const auth = useStore(s.auth);
  const prefs = useStore(s.preferences);
  const providers = useResource("settings-providers", (signal) =>
    s.libraryApi.providers(signal),
  );
  return (
    <section className="settings-page">
      <p className="eyebrow">MAKE YOURSELF AT HOME</p>
      <h2>你的聆听偏好</h2>
      <PlatformAccounts />
      {auth.session?.user.role === "admin" && <PluginStatus />}
      <div className="settings-card">
        <h3>连接与账号</h3>
        <dl>
          <div>
            <dt>音乐服务</dt>
            <dd>{window.location.origin}</dd>
          </div>
          <div>
            <dt>实例</dt>
            <dd>{auth.ready?.instanceId}</dd>
          </div>
          <div>
            <dt>协议</dt>
            <dd>MusicFS API v{auth.ready?.apiVersion}</dd>
          </div>
          <div>
            <dt>当前账号</dt>
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
          退出登录
        </button>
      </div>
      <div className="settings-card">
        <h3>外观</h3>
        <p className="muted">这些偏好仅保存在当前浏览器，按实例和账号区分。</p>
        <div className="theme-choices">
          <button
            aria-pressed={prefs.theme === "dark"}
            onClick={() => s.preference({ theme: "dark" })}
          >
            深夜 · 深色
          </button>
          <button
            aria-pressed={prefs.theme === "light"}
            onClick={() => s.preference({ theme: "light" })}
          >
            晨光 · 浅色
          </button>
        </div>
      </div>
      <div className="settings-card">
        <h3>播放</h3>
        <label className="check-label">
          <input
            type="checkbox"
            aria-label="服务端处理（降低 6 dB，下一首生效）"
            checked={prefs.processing}
            onChange={(e) => s.preference({ processing: e.target.checked })}
          />
          请求服务端处理，降低 6 dB（下一首生效）
        </label>
        <p className="muted">
          服务端根据实际插件能力协商输出；播放器会显示最终生效的处理。音量调节在浏览器中完成。
        </p>
        <label>
          默认音量{" "}
          <input
            aria-label="默认音量"
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
        <h3>音乐来源</h3>
        <ErrorNotice error={providers.error} retry={providers.reload} />
        {providers.loading && <p>正在读取来源…</p>}
        {providers.data?.map((p) => (
          <div className="setting-row" key={p.id}>
            <strong>{p.name}</strong>
            <span className="muted">
              {p.availability === "available" ? "可用" : "暂不可用"}
            </span>
          </div>
        ))}
        {providers.data?.length === 0 && <p className="muted">暂无音乐来源</p>}
        <p className="muted">音乐目录、插件与平台账号由服务端管理。</p>
      </div>
    </section>
  );
}
