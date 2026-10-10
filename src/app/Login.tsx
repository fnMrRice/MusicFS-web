import { useState } from "react";
import { useServices, useStore } from "./services";
import { ErrorNotice, Icon } from "../components/ui";
export function Login() {
  const s = useServices();
  const state = useStore(s.auth);
  const [token, setToken] = useState("");
  return (
    <div className="login-page">
      <div className="login-art">
        <div className="record">
          <span />
        </div>
        <p>YOUR MUSIC. YOUR SPACE.</p>
        <h1>
          让音乐，
          <br />
          回到你身边。
        </h1>
        <p>连接你的音乐库，聆听每一份收藏。</p>
      </div>
      <div className="login-panel">
        <div className="brand">
          <Icon name="music" size={34} />
          <strong>MusicFS</strong>
        </div>
        <h2>连接你的音乐世界</h2>
        <p className="muted">使用管理员提供的令牌登录此音乐服务。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = token;
            setToken("");
            void s.login(value);
          }}
        >
          <label htmlFor="login-token">管理员登录令牌</label>
          <input
            id="login-token"
            type="password"
            autoComplete="off"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="输入登录令牌"
            disabled={state.busy || !state.ready}
          />
          <button
            className="primary"
            disabled={state.busy || !state.ready || !token.trim()}
          >
            {state.busy ? "正在连接…" : "登录"}
          </button>
        </form>
        <ErrorNotice
          error={state.error}
          retry={() => {
            void s.connect();
          }}
        />
        <p className="login-foot">
          {state.ready ? "已连接 MusicFS · 安全会话" : "正在检查音乐服务"}
          <br />
          凭据仅用于本次登录，不保存在浏览器中。
        </p>
      </div>
    </div>
  );
}
