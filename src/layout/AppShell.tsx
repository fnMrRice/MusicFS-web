import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useServices, useStore } from "../app/services";
import { ErrorNotice, Icon, IconButton } from "../components/ui";
import { PlayerBar } from "../player/PlayerBar";
import styles from "./Shell.module.css";
import { ErrorBoundary } from '../app/ErrorBoundary';

const links = [
  ["/search", "search", "搜索"],
  ["/recommendations", "home", "推荐"],
  ["/library", "music", "曲目列表"],
  ["/playlists", "folder", "歌单管理"],
];
export function AppShell() {
  const s = useServices();
  const auth = useStore(s.auth);
  const prefs = useStore(s.preferences);
  const playlists = useStore(s.playlists);
  const location = useLocation();
  const navigate = useNavigate();
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const [account, setAccount] = useState(false);
  const [theme, setTheme] = useState(false);
  const accountRoot = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const themeRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs.theme]);
  useLayoutEffect(() => {
    const root = scroll.current;
    if (!root) return;
    const target = positions.current.get(location.key) ?? 0;
    let restored = false;
    const restore = () => {
      if (restored) return;
      root.scrollTop = target;
      restored = root.scrollHeight - root.clientHeight >= target;
    };
    restore();
    const observer = new ResizeObserver(restore);
    if (content.current) observer.observe(content.current);
    const cancel = () => { restored = true; };
    root.addEventListener('wheel', cancel, { passive: true });
    root.addEventListener('pointerdown', cancel);
    return () => {
      observer.disconnect(); root.removeEventListener('wheel', cancel); root.removeEventListener('pointerdown', cancel);
      positions.current.set(location.key, restored ? root.scrollTop : target);
    };
  }, [location.key]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!accountRoot.current?.contains(e.target as Node)) setAccount(false);
      if (!themeRoot.current?.contains(e.target as Node)) setTheme(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (account) accountButton.current?.focus();
        setAccount(false);
        setTheme(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [account]);
  useEffect(() => {
    setAccount(false);
    setTheme(false);
  }, [location.pathname]);
  const title =
    links.find(([path]) => location.pathname === path)?.[2] ??
    (location.pathname === "/settings"
      ? "设置"
      : location.pathname === "/favorites"
        ? "我的收藏"
        : location.pathname === "/recent"
          ? "最近播放"
          : location.pathname.startsWith("/albums")
            ? "专辑"
            : "歌单详情");
  const nav = (path: string, icon: string, label: string) => (
    <NavLink
      key={path}
      to={path}
      aria-label={label}
      end
      className={({ isActive }) =>
        `${styles.nav} ${isActive ? styles.active : ""}`
      }
    >
      <Icon name={icon} />
      <span>{label}</span>
    </NavLink>
  );
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="侧栏">
        <a className="brand" href="#/library">
          <Icon name="music" size={32} />
          <strong>MusicFS</strong>
        </a>
        <nav
          className={styles.navigation}
          aria-label="主导航"
          onScroll={() => setAccount(false)}
        >
          {links.map(([path, icon, label]) => nav(path, icon, label))}
          <div className={styles.group}>
            <button
              className={styles.groupToggle}
              aria-expanded={prefs.mine}
              onClick={() => s.preference({ mine: !prefs.mine })}
            >
              <span className={!prefs.mine ? styles.collapsed : ""}>
                <Icon name="chevron" size={16} />
              </span>
              我的
              {!prefs.mine &&
                ["/favorites", "/recent"].includes(location.pathname) && (
                  <span className={styles.dot} />
                )}
            </button>
          </div>
          {prefs.mine && (
            <>
              {nav("/favorites", "heart", "我的收藏")}
              {nav("/recent", "clock", "最近播放")}
            </>
          )}
          <div className={styles.group}>
            <button
              className={styles.groupToggle}
              aria-expanded={prefs.playlists}
              onClick={() => s.preference({ playlists: !prefs.playlists })}
            >
              <span className={!prefs.playlists ? styles.collapsed : ""}>
                <Icon name="chevron" size={16} />
              </span>
              歌单
              {!prefs.playlists &&
                location.pathname.startsWith("/playlists/") && (
                  <span className={styles.dot} />
                )}
            </button>
            <IconButton
              icon="plus"
              label="新建歌单"
              onClick={() => navigate("/playlists?new=1")}
            />
          </div>
          {prefs.playlists &&
            (playlists.length ? (
              playlists.map((p) =>
                nav(
                  `/playlists/${encodeURIComponent(p.playlistId)}`,
                  "album",
                  p.name,
                ),
              )
            ) : (
              <p className={styles.hint}>把喜欢的音乐放在一起</p>
            ))}
        </nav>
        <div
          className={styles.account}
          ref={accountRoot}
          onContextMenu={(e) => {
            e.preventDefault();
            setAccount(true);
          }}
        >
          <span className={styles.avatar}>
            <Icon name="user" />
          </span>
          <div>
            <strong>我的账号</strong>
            <small>{auth.session?.user.id}</small>
          </div>
          <button
            ref={accountButton}
            className="icon-button"
            aria-label="账号菜单"
            aria-expanded={account}
            onClick={() => setAccount(!account)}
          >
            <Icon name="more" />
          </button>
          {account && (
            <div
              className={`${styles.accountMenu} popover`}
              aria-label="账号操作"
            >
              <button
                onClick={() => {
                  navigate("/settings");
                }}
              >
                设置
              </button>
              <button
                disabled={auth.busy}
                onClick={() => {
                  void s.logout();
                }}
              >
                退出登录
              </button>
            </div>
          )}
        </div>
      </aside>
      <section className={styles.main}>
        <header className={styles.header}>
          <IconButton
            icon="back"
            label="返回"
            onClick={() =>
              window.history.state?.idx > 0
                ? navigate(-1)
                : navigate("/library")
            }
          />
          <h1>{title}</h1>
          <span className={styles.connection}>已连接</span>
          <div className={styles.tools}>
            <IconButton
              icon="settings"
              label="设置"
              onClick={() => navigate("/settings")}
            />
            <div ref={themeRoot}>
              <IconButton
                icon="theme"
                label="换肤"
                aria-expanded={theme}
                onClick={() => setTheme(!theme)}
              />
              {theme && (
                <div
                  className={`${styles.themeMenu} popover`}
                  aria-label="选择主题"
                >
                  <strong>为音乐换个心情</strong>
                  {(["dark", "light"] as const).map((t) => (
                    <button
                      key={t}
                      aria-pressed={prefs.theme === t}
                      onClick={() => s.preference({ theme: t })}
                    >
                      <span
                        className={`${styles.swatch} ${t === "light" ? styles.light : ""}`}
                      />
                      {t === "dark" ? "深夜 · 深色" : "晨光 · 浅色"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>
        <div
          ref={scroll}
          id="page-scroll"
          className={styles.content}
          tabIndex={0}
          aria-label="页面内容"
        >
          <ErrorNotice error={auth.error} />
          <div ref={content}><ErrorBoundary key={location.pathname}><Outlet /></ErrorBoundary></div>
        </div>
      </section>
      <PlayerBar />
    </div>
  );
}
