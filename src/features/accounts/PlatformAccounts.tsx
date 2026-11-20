import { useState } from "react";
import type { OnlineInstance } from "../../api/content";
import { Modal } from "../../components/Modal";
import { Icon } from "../../components/ui";
import { pluginName } from "../../components/source-name";
import { tr, useLocale } from "../../i18n";
import { usePlatformAccount, type Account } from "./usePlatformAccount";
import "./accounts.css";

const states: Record<string, string> = {
  signedOut: "未登录", waiting: "等待授权", scanned: "已扫码，请在手机确认",
  signedIn: "已登录", unverified: "已保存，请校验登录状态", expired: "已过期，请重新登录", canceled: "已取消登录",
};

export function PlatformAccount({ instance }: { instance: OnlineInstance }) {
  const { locale } = useLocale();
  const name = instance.plugin ? pluginName(instance.plugin, locale) : tr("未知来源");
  const { account, options, error, busy, qr, dialogOpen, startLogin, closeLogin, operation, authorizeApple, musicKitReady } = usePlatformAccount(instance);
  const pending = !!account?.loginId;
  const bound = !!account?.accountId;
  const signedIn = account?.state === "signedIn";
  const username = signedIn ? account?.displayName?.trim() : "";
  const title = username ? `${name} · ${username}` : name;
  const modalLogin = instance.platform === "netease";
  const status = !account ? "正在读取账号状态…"
    : account.state === "signedOut" || account.state === "canceled"
      ? null
      : states[account.state] ?? account.state;

  const loginActions = <div className="platform-account-actions">
    {pending && account?.method === "musicKit" && <button disabled={busy || !musicKitReady} onClick={() => { void authorizeApple(); }}>打开 Apple 授权</button>}
    {pending && account?.method === "qr" && <button disabled={busy} onClick={() => { void operation("poll"); }}>刷新扫码状态</button>}
    {(pending || dialogOpen) && <button onClick={() => { if (modalLogin) closeLogin(); else void operation("cancel"); }} disabled={!modalLogin && busy}>取消登录</button>}
  </div>;

  return <section aria-label={`${title}账号`} className="platform-account">
    <div className="platform-account-heading">
      <h4>{title}</h4>
      {!bound && <button className="primary" aria-label={`登录${name}`} disabled={busy || pending || !account || !options?.configured || instance.availability === "offline"}
        onClick={() => { void startLogin(); }}>登录</button>}
    </div>
    {signedIn && account ? <AccountProfile key={`${account.accountId}:${account.avatarUrl}`} account={account} />
      : status && <p className="muted" aria-live="polite">{status}</p>}
    {error && !dialogOpen && <p role="alert">{error}</p>}
    {instance.availability === "offline" && <p className="muted">此音乐来源暂时离线，请稍后重试。</p>}
    {options && !options.configured && <p className="muted">请先在服务端配置 Apple Music 开发者授权。</p>}
    {!modalLogin && pending && <>
      {account?.method === "qr" && <LoginQRCode src={qr} name={name} error={error} />}
      <p className="muted">{account?.method === "qr"
        ? `请使用${instance.platform === "qqmusic" ? "手机 QQ" : name}扫码，二维码过期后请重新获取。`
        : "请打开 Apple 授权并完成登录。"}</p>
      {loginActions}
    </>}
    {bound && <div className="platform-account-actions">
      <button disabled={busy} onClick={() => { void operation("check"); }}>校验登录状态</button>
      <button disabled={busy} onClick={() => { void operation("logout"); }}>退出{name}账号</button>
    </div>}
    {modalLogin && dialogOpen && <Modal title={`登录${name}`} close={closeLogin}>
      <div className="platform-login-content">
        <LoginQRCode src={qr} name={name} error={error} inactive={!pending && !busy} />
        <p className="muted">请使用{name} App 扫码，二维码过期后请重新获取。</p>
        {account && pending && <p aria-live="polite">{states[account.state] ?? account.state}</p>}
        {account?.state === "expired" && <p role="status">二维码已过期，请重新获取。</p>}
        {error && <p role="alert">{error}</p>}
        {(!pending || error) && !busy && <button onClick={() => { void startLogin(); }}>重新获取二维码</button>}
        {loginActions}
      </div>
    </Modal>}
  </section>;
}

function AccountProfile({ account }: { account: Account }) {
  const [failed, setFailed] = useState(false);
  const username = account.displayName?.trim() || "已登录账号";
  return <div className="platform-account-profile" aria-live="polite">
    {account.avatarUrl && !failed ? <img className="platform-account-avatar" src={account.avatarUrl} alt={`${username}的头像`}
      width={48} height={48} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <span className="platform-account-avatar platform-account-avatar-fallback" role="img" aria-label="默认头像"><Icon name="user" size={24} /></span>}
    <div className="platform-account-identity"><strong>{username}</strong><span className="muted">已登录</span></div>
  </div>;
}

function LoginQRCode({ src, name, error, inactive = false }: { src: string; name: string; error: string; inactive?: boolean }) {
  const [loaded, setLoaded] = useState("");
  const [failed, setFailed] = useState("");
  const ready = !!src && loaded === src;
  const broken = !!src && failed === src;
  return <div className="platform-login-qr" aria-busy={!ready && !broken && !error && !inactive}>
    {src && !broken && <img src={src} width={224} height={224} alt={`${name}登录二维码`}
      style={{ visibility: ready ? "visible" : "hidden" }} onLoad={() => setLoaded(src)} onError={() => setFailed(src)} />}
    {!ready && !broken && !error && !inactive && <div className="platform-login-placeholder" role="status">
      <span className="platform-login-spinner" aria-hidden="true" />
      <span>正在加载二维码</span>
    </div>}
    {!ready && !broken && (error || inactive) && <p className="platform-login-placeholder">二维码暂不可用</p>}
    {broken && <p className="platform-login-placeholder" role="alert">二维码加载失败，请关闭后重新登录。</p>}
  </div>;
}
