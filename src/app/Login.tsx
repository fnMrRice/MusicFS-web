import { tr, useLocale } from "../i18n";
import { useState } from "react";
import { useServices, useStore } from "./services";
import { ErrorNotice } from "../components/ui";
import { BrandMark } from "../components/BrandMark";
import { LanguageSelect } from "../i18n/LanguageSelect";
export function Login() {
  useLocale();
  const s = useServices();
  const state = useStore(s.auth);
  const [token, setToken] = useState("");
  return (
    <div className="login-page">
      <div className="login-art">
        <div className="record">
          <span />
        </div>
        <p>{tr("YOUR MUSIC. YOUR SPACE.")}</p>
        <h1>
          {tr("让音乐，")}
          <br />
          {tr("回到你身边。")}
        </h1>
        <p>{tr("连接你的音乐库，聆听每一份收藏。")}</p>
      </div>
      <div className="login-panel">
        <LanguageSelect />
        <div className="brand">
          <BrandMark size={34} />
          <strong>MusicFS</strong>
        </div>
        <h2>{tr("连接你的音乐世界")}</h2>
        <p className="muted">{tr("使用管理员提供的令牌登录此音乐服务。")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = token;
            setToken("");
            void s.login(value);
          }}
        >
          <label htmlFor="login-token">{tr("管理员登录令牌")}</label>
          <input
            id="login-token"
            type="password"
            autoComplete="off"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tr("输入登录令牌")}
            disabled={state.busy || !state.ready}
          />
          <button
            className="primary"
            disabled={state.busy || !state.ready || !token.trim()}
          >
            {state.busy ? tr("正在连接…") : tr("登录")}
          </button>
        </form>
        <ErrorNotice
          error={state.error}
          retry={() => {
            void s.connect();
          }}
        />
        <p className="login-foot">
          {state.ready
            ? tr("已连接 MusicFS · 安全会话")
            : tr("正在检查音乐服务")}
          <br />
          {tr("凭据仅用于本次登录，不保存在浏览器中。")}
        </p>
      </div>
    </div>
  );
}
