import type { OnlineInstance, OnlinePlaylist } from "../../api/content";
import { useServices, useStore } from "../../app/services";

export function partitionAccountPlaylists(items: readonly OnlinePlaylist[]) {
  const writable: OnlinePlaylist[] = [];
  const saved: OnlinePlaylist[] = [];
  for (const item of items) {
    if (item.writable) writable.push(item);
    else saved.push(item);
  }
  return { writable, saved };
}

export function useAccountPlaylistFolders(source: OnlineInstance, view: "sidebar" | "management") {
  const services = useServices();
  const folders = useStore(services.preferences).playlistFolders;
  const account = JSON.stringify([source.instanceId, source.accountId]);
  const accountKey = view === "sidebar" ? account : `management/${account}`;
  const savedKey = `${accountKey}/saved`;
  const expanded = folders[accountKey] !== false;
  const savedExpanded = folders[savedKey] === true;

  function setExpanded(key: string, value: boolean) {
    services.preference({ playlistFolders: { ...services.preferences.value.playlistFolders, [key]: value } });
  }

  return {
    expanded, savedExpanded,
    toggle: () => setExpanded(accountKey, !expanded),
    toggleSaved: () => setExpanded(savedKey, !savedExpanded),
  };
}
