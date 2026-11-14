import { Link, useLocation } from "react-router-dom";
import { useServices, useStore } from "../app/services";
import { Icon } from "../components/ui";
import { workListPath, type WorkTypes } from "../features/works/navigation";
import { tr, useLocale } from "../i18n";
import styles from "./LibraryNavigation.module.css";

export function LibraryNavigation({ types }: { types: WorkTypes }) {
  useLocale();
  const services = useServices();
  const expanded = useStore(services.preferences).works;
  const setExpanded = (works: boolean) => services.preference({ works });
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const isWorks = location.pathname === "/works" || location.pathname.startsWith("/works/");
  const isTracks = location.pathname === "/library" || location.pathname.startsWith("/albums/");
  const contentType = query.get("contentType");
  const current = isWorks || isTracks;
  const categories = (types.data ?? []).flatMap((type) => type.library ? [{ ...type.library, type }] : [])
    .sort((left, right) => left.order - right.order || left.type.id.localeCompare(right.type.id));
  const entries = [
    { href: "/library", icon: "music", label: tr("曲目列表"), active: isTracks },
    ...categories.map(({ type, icon }) => ({
      href: workListPath(type.id),
      icon,
      label: tr(type.name),
      active: isWorks && contentType === type.id,
    })),
  ];
  return <div className={styles.libraryGroup}>
    <button type="button" className={`${styles.header} ${current ? styles.within : ""} ${current && !expanded ? styles.selected : ""}`}
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
