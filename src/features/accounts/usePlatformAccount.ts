import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { version as webVersion } from "../../../package.json";
import { useServices, useStore } from "../../app/services";
import { errorMessage } from "../../api/client";
import { withRateLimitRetry } from "../../api/rate-limit";
import type { OnlineInstance } from "../../api/content";
import { loadMusicKit, type MusicKitInstance } from "./musickit";

export interface Account {
  state: string;
  accountId?: string;
  displayName?: string;
  avatarUrl?: string;
  membershipTier?: "free" | "vip" | "svip";
  loginId?: string;
  method?: string;
  qrUrl?: string;
  qrImage?: string;
  expiresAt?: string;
  pollAfterSeconds?: number;
}
interface Options { method: string; configured: boolean; developerToken?: string }

export function usePlatformAccount(instance: OnlineInstance) {
  const s = useServices();
  const { session } = useStore(s.auth);
  const path = `/online-instances/${encodeURIComponent(instance.instanceId)}/account`;
  const [account, setAccount] = useState<Account | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [requestError, setError] = useState("");
  const [qrError, setQRError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQR] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [musicKit, setMusicKit] = useState<MusicKitInstance | null>(null);
  const alive = useRef(false);
  const generation = useRef(0);
  const active = useRef<Account | null>(null);
  const locked = useRef(false);
  const work = useRef<Promise<void> | null>(null);
  const cleanup = useRef<Promise<unknown>>(Promise.resolve());
  const error = requestError || qrError;

  function current(version: number) {
    return alive.current && generation.current === version && s.auth.value.session === session;
  }

  async function cancelChallenge(loginId?: string) {
    // A changed MusicFS session must never receive an old user's operation.
    if (!loginId || s.auth.value.session !== session) return;
    await s.client.request<Account>(path, {
      method: "POST", body: { action: "cancel", loginId }, keepalive: true,
    });
  }

  function accept(view: Account) {
    active.current = view;
    setAccount(view);
    if (view.state === "signedIn") {
      setDialogOpen(false);
      setError("");
    }
  }

  useEffect(() => {
    alive.current = true;
    const version = ++generation.current;
    const controller = new AbortController();
    active.current = null;
    locked.current = false;
    setAccount(null); setOptions(null); setError(""); setQRError("");
    setQR(""); setBusy(false); setDialogOpen(false); setMusicKit(null);
    const { signal } = controller;
    const sameSession = () => !signal.aborted && s.auth.value.session === session;
    async function loadAccount() {
      const view = await withRateLimitRetry(() => s.client.request<Account>(path, { signal }), signal);
      if (!current(version) || signal.aborted) return;
      accept(view);
      if (view.loginId && instance.platform === "netease") setDialogOpen(true);

      // 每个来源依次读取状态和登录选项，避免打开设置页时同时占用两份账号并发配额。
      const opts = await withRateLimitRetry(() => s.client.request<Options>(`${path}/options`, { signal }), signal);
      if (sameSession()) setOptions(opts);
    }
    void loadAccount().catch((e: unknown) => {
      if (sameSession()) setError(errorMessage(e));
    });
    return () => {
      alive.current = false;
      ++generation.current;
      controller.abort();
      const cancel = cancelChallenge(active.current?.loginId).catch(() => {});
      cleanup.current = Promise.allSettled([cleanup.current, work.current, cancel]);
    };
  }, [path, s, session]);

  useEffect(() => {
    let valid = true;
    setQR(""); setQRError("");
    if (!account?.loginId || account.method !== "qr") return;
    if (account.qrImage?.startsWith("data:image/png;base64,")) setQR(account.qrImage);
    else if (account.qrUrl) {
      void QRCode.toDataURL(account.qrUrl, { width: 224, margin: 3 }).then(
        (image) => { if (valid) setQR(image); },
        () => { if (valid) setQRError("二维码生成失败，请重新获取二维码。"); },
      );
    } else setQRError("未收到有效二维码，请重新获取二维码。");
    return () => { valid = false; };
  }, [account?.loginId, account?.method, account?.qrImage, account?.qrUrl]);

  async function perform(action: string, version: number, userToken?: string) {
    if (!current(version)) return;
    if (action === "logout") s.sourcePlaylists.invalidate(instance.instanceId);
    try {
      const view = await s.client.request<Account>(path, {
        method: "POST",
        body: { action, loginId: active.current?.loginId ?? "", userToken: userToken ?? "" },
      });
      if (!current(version)) {
        // Begin may finish after the dialog closed, before its ID was known.
        if (action === "begin") await cancelChallenge(view.loginId).catch(() => {});
        return;
      }
      accept(view);
      if (!view.loginId) void s.platformAccountChanged(instance.instanceId, view.state === "signedIn");
      if (action === "begin" && !view.loginId && !view.accountId)
        setError("登录会话未能创建，请重试。");
      if (action === "logout" && musicKit) await musicKit.unauthorize();
    } catch (e) {
      if (current(version)) setError(errorMessage(e));
      // A lost response does not undo the server operation. Recover its state.
      if (s.auth.value.session !== session) return;
      try {
        const recovered = await s.client.request<Account>(path);
        if (!current(version)) {
          if (action === "begin") await cancelChallenge(recovered.loginId).catch(() => {});
          return;
        }
        accept(recovered);
        void s.platformAccountChanged(instance.instanceId, recovered.state === "signedIn");
      } catch { /* Keep the actionable error. */ }
    }
  }

  async function run(task: (version: number) => Promise<void>) {
    if (locked.current || !alive.current) return;
    const version = generation.current;
    locked.current = true;
    setBusy(true); setError("");
    const pending = (async () => {
      try {
        // A new begin must not reuse a challenge that is still being canceled.
        await cleanup.current;
        if (current(version)) await task(version);
      } catch (e) {
        if (current(version)) setError(errorMessage(e));
      } finally {
        if (current(version)) { locked.current = false; setBusy(false); }
      }
    })();
    work.current = pending;
    await pending;
    if (work.current === pending) work.current = null;
  }

  async function operation(action: string, userToken?: string) {
    if (["poll", "complete", "cancel"].includes(action) && !active.current?.loginId) return;
    await run((version) => perform(action, version, userToken));
  }

  function closeLogin() {
    if (active.current?.state === "signedIn" && !active.current.loginId) {
      setDialogOpen(false);
      return;
    }
    ++generation.current;
    locked.current = false;
    setDialogOpen(false); setBusy(false); setError(""); setQRError(""); setQR("");
    const previous = active.current;
    const restored: Account = previous?.accountId
      ? { state: "unverified", accountId: previous.accountId, displayName: previous.displayName, avatarUrl: previous.avatarUrl }
      : { state: "signedOut" };
    active.current = restored;
    setAccount(restored);
    const version = generation.current;
    const cancel = cancelChallenge(previous?.loginId).catch((e: unknown) => {
      if (current(version)) setError(errorMessage(e));
    });
    cleanup.current = Promise.allSettled([cleanup.current, work.current, cancel]);
  }

  async function startLogin() {
    if (locked.current) return;
    if (active.current?.loginId) closeLogin();
    ++generation.current;
    setQR(""); setQRError(""); setError("");
    if (instance.platform === "netease") setDialogOpen(true);
    await run(async (version) => {
      if (options?.method === "musicKit") {
        if (!options.developerToken) return;
        const api = await loadMusicKit();
        if (!current(version)) return;
        const kit = await api.configure({ developerToken: options.developerToken, app: { name: "MusicFS", build: webVersion } });
        if (!current(version)) return;
        // Clear a previous browser authorization before requesting a new account.
        await kit.unauthorize();
        if (!current(version)) return;
        setMusicKit(kit);
      }
      await perform("begin", version);
    });
  }

  async function authorizeApple() {
    if (!musicKit) return;
    await run(async (version) => {
      try {
        const token = await musicKit.authorize();
        if (current(version)) await perform("complete", version, token);
      } catch {
        if (current(version)) setError("Apple Music 授权未完成，可重试或取消。");
      }
    });
  }

  useEffect(() => {
    if (!account?.loginId || account.method !== "qr" || busy || error) return;
    const timer = window.setTimeout(() => { void operation("poll"); }, Math.max(account.pollAfterSeconds ?? 3, 3) * 1000);
    return () => window.clearTimeout(timer);
  }, [account, busy, error]);

  return {
    account, options, error, busy, qr, dialogOpen, startLogin, closeLogin,
    operation, authorizeApple, musicKitReady: musicKit !== null,
  };
}
