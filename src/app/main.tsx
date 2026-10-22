import { tr, useLocale } from "../i18n";
import { StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Services, ServicesContext, useServices, useStore } from "./services";
import { Login } from "./Login";
import { ErrorBoundary } from "./ErrorBoundary";
import { AppShell } from "../layout/AppShell";
import { Library } from "../features/Library";
import { Favorites } from "../features/Favorites";
import { Works } from "../features/works/Works";
import { WorkDetail } from "../features/works/WorkDetail";
import { Search } from "../features/Search";
import {
  Recommendations,
  DiscoveryPlaylist,
} from "../features/Recommendations";
import { Playlists } from "../features/playlists/Playlists";
import { PlaylistDetail } from "../features/playlists/PlaylistDetail";
import { SourcePlaylists } from "../features/playlists/SourcePlaylists";
import { AlbumDetail } from "../features/AlbumDetail";
import { Settings } from "../features/Settings";
import { Empty } from "../components/ui";
import "../styles/global.css";

const root = document.getElementById("app");
if (!root) throw new Error("Missing application root");
const audioRoot = document.createElement("div");
audioRoot.hidden = true;
document.body.append(audioRoot);
const services = new Services(audioRoot);
function Application() {
  useLocale();
  const s = useServices();
  const auth = useStore(s.auth);
  const prefs = useStore(s.preferences);
  useLayoutEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.dataset.theme =
        prefs.theme === "system"
          ? systemTheme.matches
            ? "dark"
            : "light"
          : prefs.theme;
    };
    applyTheme();
    if (prefs.theme !== "system") return;
    systemTheme.addEventListener("change", applyTheme);
    return () => systemTheme.removeEventListener("change", applyTheme);
  }, [prefs.theme]);
  if (!auth.session) return <Login />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/library" element={<Library />} />
        <Route path="/works" element={<Works />} />
        <Route path="/works/:id" element={<WorkDetail />} />
        <Route path="/search" element={<Search />} />
        <Route path="/recommendations" element={<Recommendations />} />
        <Route path="/playlists" element={<Playlists />} />
        <Route path="/playlists/:id" element={<PlaylistDetail />} />
        <Route path="/sources/:instance/playlists" element={<SourcePlaylists />} />
        <Route
          path="/discover/:instance/:external"
          element={<DiscoveryPlaylist />}
        />
        <Route path="/albums/:id" element={<AlbumDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route
          path="/recent"
          element={
            <Empty title={tr("暂无播放记录")} icon="clock" />
          }
        />
        <Route path="*" element={<Navigate to="/library" replace />} />
      </Route>
    </Routes>
  );
}
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <ServicesContext.Provider value={services}>
        <HashRouter>
          <Application />
        </HashRouter>
      </ServicesContext.Provider>
    </ErrorBoundary>
  </StrictMode>,
);
window.addEventListener("pagehide", () => services.player.stop());
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    services.clear();
    audioRoot.remove();
  });
void services.connect();
