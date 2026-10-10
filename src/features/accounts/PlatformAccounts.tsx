import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { errorMessage } from "../../api/client";
import type { OnlineInstance } from "../../api/content";
import { loadMusicKit, type MusicKitInstance } from "./musickit";

interface Account {
  state: string; accountId?: string; displayName?: string;
  loginId?: string; method?: string; qrUrl?: string; qrImage?: string;
  expiresAt?: string; pollAfterSeconds?: number;
}
interface Options { method: string; configured: boolean; developerToken?: string }
const names: Record<string, string> = { netease: "网易云音乐", qqmusic: "QQ 音乐", applemusic: "Apple Music" };
const states: Record<string, string> = { signedOut: "未登录", waiting: "等待授权", scanned: "已扫码，请在手机确认", signedIn: "已登录", unverified: "已保存，待校验", expired: "已过期，请重新登录", canceled: "已取消" };

export function PlatformAccounts() {
  const s = useServices();
  const list = useResource("platform-account-instances", (signal) => s.client.request<{ items: OnlineInstance[] }>("/online-instances", { signal }));
  return <div className="settings-card"><h3>音乐平台账号</h3>
    <p className="muted">使用在线来源前请先登录对应音乐平台。登录不表示拥有会员或完整在线播放权限。</p>
    {list.error && <p role="alert">{list.error}</p>}
    {list.data?.items.map((instance) => <AccountCard key={instance.instanceId} instance={instance} />)}
    {list.data?.items.length === 0 && <p>尚未配置在线音乐来源。</p>}
  </div>;
}
function AccountCard({ instance }: { instance: OnlineInstance }) {
  const s = useServices();
  const path = `/online-instances/${encodeURIComponent(instance.instanceId)}/account`;
  const name = names[instance.platform] ?? instance.name;
  const [account, setAccount] = useState<Account | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQR] = useState("");
  const [musicKit, setMusicKit] = useState<MusicKitInstance | null>(null);
  const alive = useRef(true);
  const active = useRef<Account | null>(null);
  const locked = useRef(false);
  const setCurrent = (value: Account) => {
    active.current = value;
    if (alive.current) setAccount(value);
    else if (value.loginId) void s.client.request(path, { method: "POST", body: { action: "cancel", loginId: value.loginId }, keepalive: true }).catch(() => {});
  };
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void Promise.all([
      s.client.request<Account>(path, { signal: controller.signal }),
      s.client.request<Options>(`${path}/options`, { signal: controller.signal }),
    ]).then(([view, opts]) => { if (!controller.signal.aborted) { setCurrent(view); setOptions(opts); } }, (e: unknown) => { if (!controller.signal.aborted) setError(errorMessage(e)); });
    return () => {
      alive.current = false; controller.abort();
      const loginId = active.current?.loginId;
      if (loginId) void s.client.request(path, { method: "POST", body: { action: "cancel", loginId }, keepalive: true }).catch(() => {});
    };
  }, [path, s]);
  useEffect(() => {
    let current = true;
    setQR("");
    if (account?.qrImage?.startsWith("data:image/png;base64,")) setQR(account.qrImage);
    else if (account?.qrUrl) void QRCode.toDataURL(account.qrUrl, { width: 224, margin: 3 }).then((image) => { if (current) setQR(image); });
    return () => { current = false; };
  }, [account?.qrImage, account?.qrUrl]);
  async function operation(action: string, userToken?: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const view = await s.client.request<Account>(path, { method: "POST", body: { action, loginId: active.current?.loginId ?? "", userToken: userToken ?? "" } });
      setCurrent(view);
      if (action === "logout" && musicKit) await musicKit.unauthorize();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
      // A lost response does not undo the server operation. Recover its state.
      try { setCurrent(await s.client.request<Account>(path)); } catch { /* Keep the actionable error. */ }
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    if (!account?.loginId || account.method !== "qr" || busy || error) return;
    const timer = window.setTimeout(() => { void operation("poll"); }, Math.max(account.pollAfterSeconds ?? 3, 3) * 1000);
    return () => window.clearTimeout(timer);
  }, [account, busy, error]);
  async function prepareApple() {
    if (!options?.developerToken) return;
    setBusy(true); setError("");
    try {
      const api = await loadMusicKit();
      const kit = await api.configure({ developerToken: options.developerToken, app: { name: "MusicFS", build: "0.1.0" } });
      // Clear a previous browser authorization before requesting a new account.
      await kit.unauthorize(); setMusicKit(kit);
      setBusy(false); await operation("begin");
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  async function authorizeApple() {
    if (!musicKit) return;
    setBusy(true); setError("");
    try { const token = await musicKit.authorize(); setBusy(false); await operation("complete", token); }
    catch { setError("Apple Music 授权未完成，可重试或取消。"); setBusy(false); }
  }
  const pending = !!account?.loginId;
  const bound = !!account?.accountId;
  return <section aria-label={`${name}账号`} style={{ marginBlock: 20 }}>
    <h4>{name} · {instance.name}</h4>
    <p aria-live="polite">{account ? states[account.state] ?? account.state : "正在读取账号状态…"}{account?.displayName ? ` · ${account.displayName}` : ""}</p>
    {error && <p role="alert">{error}</p>}
    {options && !options.configured && <p>请先在服务端配置 Apple Music 开发者授权。</p>}
    {qr && pending && <img src={qr} width={224} height={224} alt={`${name}登录二维码`} />}
    {pending && <p>请使用{instance.platform === "qqmusic" ? "手机 QQ" : name}扫码或完成授权。二维码和授权会话有效期为三分钟。</p>}
    {!pending && !bound && <button disabled={busy || !options?.configured || instance.availability === "offline"} onClick={() => { void (options?.method === "musicKit" ? prepareApple() : operation("begin")); }}>登录{name}</button>}
    {pending && account?.method === "musicKit" && <button disabled={busy || !musicKit} onClick={() => { void authorizeApple(); }}>打开 Apple 授权</button>}
    {pending && account?.method === "qr" && <button disabled={busy} onClick={() => { void operation("poll"); }}>刷新扫码状态</button>}
    {pending && <button disabled={busy} onClick={() => { void operation("cancel"); }}>取消登录</button>}
    {bound && <><button disabled={busy} onClick={() => { void operation("check"); }}>校验登录状态</button><button disabled={busy} onClick={() => { void operation("logout"); }}>退出{name}账号</button></>}
  </section>;
}
