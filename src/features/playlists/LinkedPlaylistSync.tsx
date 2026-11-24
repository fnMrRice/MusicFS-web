import { favoritesPlaylistId, playlistLinks, type PlaylistLink } from "../../api/playlist-links";
import { useServices, useStore } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { useSourceName } from "../../components/use-source-name";
import { tr } from "../../i18n";
import { PlaylistSyncStatus } from "./PlaylistSyncStatus";

export function LinkedPlaylistSync({ link, finished }: { link: PlaylistLink; finished?: () => void }) {
  const s = useServices();
  return <PlaylistSyncStatus key={JSON.stringify([link.instanceId, link.accountId, link.externalId, link.jobId])}
    jobId={link.jobId} start={(signal, knownId) =>
      s.content.syncLink({ ...link, remotePlaylistId: link.remotePlaylistId ?? knownId }, signal)}
    synced={async () => {
      s.sourcePlaylists.revalidate(link.instanceId, true);
      finished?.();
      if (link.playlistId === favoritesPlaylistId) await s.favorites.load(true);
    }} />;
}

export function LocalPlaylistSync({ playlistId, finished }: { playlistId: string; finished?: () => void }) {
  const s = useServices();
  const { session } = useStore(s.auth);
  const sourceName = useSourceName();
  const sources = useStore(s.sourcePlaylists.pages);
  const links = useResource(`local-playlist-links:${session?.user.id}`, signal => playlistLinks(s.client, signal));
  const targets = links.data?.filter(link => link.playlistId === playlistId) ?? [];
  return <>
    <ErrorNotice error={links.error} retry={links.reload} />
    {targets.map(link => {
      const label = sources[link.instanceId]?.items.find(item => item.externalId === link.externalId)?.title;
      return <div className="linked-playlist-sync" key={JSON.stringify([link.instanceId, link.accountId, link.externalId])}>
        <span>{sourceName(link.instanceId)} · {label || tr("远程歌单 {0}", { 0: link.externalId })}</span>
        <LinkedPlaylistSync link={link} finished={finished} />
      </div>;
    })}
  </>;
}
