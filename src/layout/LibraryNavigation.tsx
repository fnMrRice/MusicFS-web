import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { WorksApi } from "../api/works";
import { useServices, useStore } from "../app/services";
import { useResource } from "../components/query";
import { Icon } from "../components/ui";
import { workCategoryName } from "../features/works/navigation";
import { tr, useLocale } from "../i18n";
import styles from "./LibraryNavigation.module.css";

export function LibraryNavigation() {
  useLocale();
  const services = useServices();
  const expanded = useStore(services.preferences).works;
  const setExpanded = (works: boolean) => services.preference({ works });
  const api = useMemo(() => new WorksApi(services.client), [services]);
  const types = useResource("work-content-types", (signal) => api.types(signal));
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const isWorks = location.pathname === "/works" || location.pathname.startsWith("/works/");
  const isTracks = location.pathname === "/library";
  const cdDump = isWorks && query.get("packageKind") === "cd_dump";
  const contentType = query.get("contentType");
  const overview = location.pathname === "/works" && !contentType && !query.has("packageKind");
  const current = isWorks || isTracks || location.pathname.startsWith("/albums/");
  const rank = (id: string) => id === "music" ? 0 : id === "asmr" ? 1 : 2;
  const categories = [...(types.data ?? [])].sort((left, right) => rank(left.id) - rank(right.id));
  const entries = [
    { href: "/works", icon: "album", label: tr("全部作品"), active: overview },
    { href: "/library", icon: "music", label: tr("曲目列表"), active: isTracks },
    ...categories.map((type) => ({
      href: `/works?contentType=${encodeURIComponent(type.id)}`,
      icon: type.id === "asmr" ? "headphones" : "album",
      label: workCategoryName(type),
      active: isWorks && !cdDump && contentType === type.id,
    })),
    { href: "/works?packageKind=cd_dump", icon: "disc", label: tr("CD 抓轨"), active: cdDump },
  ];
  return <div className={styles.libraryGroup}>
    <button type="button" className={`${styles.header} ${current ? styles.within : ""} ${overview || (current && !expanded) ? styles.selected : ""}`}
      aria-expanded={expanded} aria-controls="work-library-navigation"
      aria-label={tr(expanded ? "收起作品库" : "展开作品库")}
      title={tr(expanded ? "收起作品库" : "展开作品库")}
      onClick={() => setExpanded(!expanded)}>
      <span className={styles.parent}>
        <Icon name="album" /><span>{tr("作品库")}</span>
      </span>
      <span className={styles.toggle} aria-hidden="true">
        <span className={expanded ? "" : styles.collapsed}><Icon name="chevron" size={16} /></span>
      </span>
    </button>
    <div id="work-library-navigation" className={styles.children} hidden={!expanded}>
      {entries.map((entry) => <Link key={entry.href} to={entry.href} className={`${styles.child} ${entry.active ? styles.active : ""}`}
        aria-label={entry.label} aria-current={entry.active ? "page" : undefined} title={entry.label}>
        <Icon name={entry.icon} size={18} /><span>{entry.label}</span>
      </Link>)}
      {types.error && <button className={styles.retry} onClick={types.reload}>{tr("重试加载分类")}</button>}
    </div>
  </div>;
}
