import { useId, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { OnlineInstance, OnlinePlaylist } from "../api/content";
import { Icon } from "../components/ui";
import { remotePlaylistLabel, remotePlaylistPath } from "../features/playlists/remote-playlist-link";
import { partitionAccountPlaylists, useAccountPlaylistFolders } from "../features/playlists/account-playlist-folders";
import { tr, useLocale } from "../i18n";
import styles from "./NeteasePlaylistFolder.module.css";

function FolderButton({ label, expanded, controls, toggle }: {
  label: string; expanded: boolean; controls: string; toggle: () => void;
}) {
  return <button type="button" className={styles.folder} aria-expanded={expanded} aria-controls={controls}
    title={label} onClick={toggle}>
    <span className={styles.chevron}><Icon name="chevron" size={14} /></span>
    <Icon name="folder" size={18} />
    <span className={styles.label}>{label}</span>
  </button>;
}

export function NeteasePlaylistFolder({ source, label, items, children }: {
  source: OnlineInstance; label: string; items: OnlinePlaylist[]; children: ReactNode;
}) {
  const { locale } = useLocale();
  const { expanded, savedExpanded, toggle, toggleSaved } = useAccountPlaylistFolders(source, "sidebar");
  const { writable, saved } = partitionAccountPlaylists(items);
  const id = useId();
  const savedId = id + "-saved";
  const link = (item: OnlinePlaylist) => {
    const name = remotePlaylistLabel(source, item, locale);
    return <NavLink key={item.externalId} to={remotePlaylistPath(source.instanceId, item.externalId)}
      className={styles.playlist} title={name} aria-label={name}>
      <Icon name="album" size={16} /><span className={styles.label}>{item.title}</span>
    </NavLink>;
  };
  const viewLabel = tr("查看 {0}", { 0: label });
  return <div className={styles.tree}>
    <div className={styles.heading}>
      <FolderButton label={label} expanded={expanded} controls={id} toggle={toggle} />
      <NavLink className={styles.overview} to={`/sources/${encodeURIComponent(source.instanceId)}/playlists`}
        title={viewLabel} aria-label={viewLabel}><Icon name="queue" size={17} /></NavLink>
    </div>
    <div className={styles.children} id={id} hidden={!expanded}>
      {writable.map(link)}
      {saved.length > 0 && <>
        <FolderButton label={tr("收藏的歌单")} expanded={savedExpanded} controls={savedId} toggle={toggleSaved} />
        <div className={styles.children} id={savedId} hidden={!savedExpanded}>{saved.map(link)}</div>
      </>}
      {children}
    </div>
  </div>;
}
