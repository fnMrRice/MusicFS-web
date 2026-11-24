import type { OnlineInstance, OnlinePlaylist } from "../../api/content";
import { pluginName } from "../../components/source-name";

export const remotePlaylistPath = (instanceId: string, externalId: string) =>
  `/discover/${encodeURIComponent(instanceId)}/${encodeURIComponent(externalId)}`;

export const remotePlaylistLabel = (instance: OnlineInstance, playlist: OnlinePlaylist, locale: string) =>
  `${pluginName(instance.plugin, locale)}-${playlist.title}`;
