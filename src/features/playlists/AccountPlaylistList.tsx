import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import type { OnlineInstance, OnlinePlaylist } from "../../api/content";
import { favoritesPlaylistId, playlistLinks, type PlaylistLink } from "../../api/playlist-links";
import { useServices, useStore } from "../../app/services";
import { useResource } from "../../components/query";
import { pluginName } from "../../components/source-name";
import { useSourceName } from "../../components/use-source-name";
import { ErrorNotice, Icon, SectionToggle } from "../../components/ui";
import { formatDate, tr, useLocale } from "../../i18n";
import { PlaylistLinkDialog } from "./PlaylistLinkDialog";
import { partitionAccountPlaylists, useAccountPlaylistFolders } from "./account-playlist-folders";

export const remotePlaylistPath = (instanceId: string, externalId: string) =>
  `/discover/${encodeURIComponent(instanceId)}/${encodeURIComponent(externalId)}`;
export const remotePlaylistLabel = (instance: OnlineInstance, playlist: OnlinePlaylist, locale: string) =>
  `${pluginName(instance.plugin, locale)}-${playlist.title}`;

function supportsLinks(source: OnlineInstance) {
  return !!source.accountId && source.capabilities.some((c) => c.name === "playlist.addTracks" && c.supported);
}
export function AccountPlaylistLists({ sources, management = false }: { sources: OnlineInstance[]; management?: boolean }) {
  const s = useServices();
  const sourceName = useSourceName();
  const writable = sources.filter(supportsLinks);
  const key = JSON.stringify(writable.map((source) => [source.instanceId, source.accountId, source.accountRevision]));
  const links = useResource(`playlist-links:${key}`, (signal) =>
    writable.length ? playlistLinks(s.client, signal) : Promise.resolve([]));
  return <>
    <ErrorNotice error={links.error} retry={links.reload} />
    {sources.map((source) => <AccountPlaylistList key={JSON.stringify([source.instanceId, source.accountId, source.accountRevision])}
      source={source} heading={tr("{0} 的歌单", { 0: sourceName(source) })} management={management} links={links} />)}
  </>;
}
function AccountPlaylistList({ source, heading, management, links }: {
  source: OnlineInstance; heading: string; management: boolean; links: ReturnType<typeof useResource<PlaylistLink[]>>;
}) {
  const s = useServices();
  const { locale } = useLocale();
  const { instanceId, accountId } = source;
  const page = useStore(s.sourcePlaylists.pages)[instanceId];
  const status = useStore(s.sourcePlaylists.status)[instanceId];
  const local = useStore(s.playlists);
  const canLink = supportsLinks(source);
  const folders = useAccountPlaylistFolders(source, "management");
  const bodyId = useId();
  const savedId = useId();
  const groupSaved = management && source.platform === "netease";
  const items = page?.items ?? [];
  const groups = groupSaved ? partitionAccountPlaylists(items) : null;
  const [editing, setEditing] = useState<{ playlist: OnlinePlaylist; link?: PlaylistLink } | null>(null);
  useEffect(() => {
    if (source.platform === "netease") s.sourcePlaylists.revalidate(instanceId);
  }, [s, instanceId, source.platform]);
  function refresh() {
    s.sourcePlaylists.refresh(instanceId, source.platform === "netease");
    links.reload();
  }
  function playlistRow(playlist: OnlinePlaylist) {
    const link = links.data?.find((item) => item.platform === source.platform && item.accountId === accountId
      && item.externalId === playlist.externalId);
    const linkedToFavorites = link?.playlistId === favoritesPlaylistId;
    const linkedName = linkedToFavorites ? tr("我的收藏") : local.find((item) => item.playlistId === link?.playlistId)?.name;
    return <div className="remote-row account-playlist" key={playlist.externalId}>
      <div>
        <Link to={remotePlaylistPath(instanceId, playlist.externalId)} className="account-playlist-link">
          <Icon name="album" /><strong>{management ? remotePlaylistLabel(source, playlist, locale) : playlist.title}</strong>
          <small>{tr("{0} 首", { 0: playlist.trackCount ?? tr("未知数量") })}</small>
        </Link>
        {link && <p className="muted">
          <Link to={linkedToFavorites ? "/favorites" : `/playlists/${encodeURIComponent(link.playlistId)}`}>{tr("已关联：{0}", { 0: linkedName ?? link.playlistId })}</Link>
          {link.pendingCount > 0 && ` · ${tr("{0} 首待同步", { 0: link.pendingCount })}`}
          {link.lastErrorCode && ` · ${tr("同步失败（{0}）", { 0: link.lastErrorCode })}`}
        </p>}
      </div>
      {canLink && (link || playlist.writable === true)
        ? <button disabled={!links.data} onClick={() => setEditing({ playlist, link })}>
          {tr(link ? "解除关联" : "关联本地歌单")}
        </button>
        : canLink && !groupSaved && <small className="muted">{tr("只读")}</small>}
    </div>;
  }
  return <section className="source-section" aria-label={heading}>
    <div className="section-title">
      <h2>{management
        ? <SectionToggle title={heading} expanded={folders.expanded} controls={bodyId} onClick={folders.toggle} />
        : heading}</h2>
      <button onClick={refresh} disabled={status?.loading}>{tr("刷新歌单")}</button>
    </div>
    <div id={bodyId} hidden={management && !folders.expanded}>
      <ErrorNotice error={status?.error ?? null} retry={refresh} />
      {(groups?.writable ?? items).map(playlistRow)}
      {!!groups?.saved.length && <section className="saved-account-playlists">
        <h3><SectionToggle title={tr("收藏的歌单")} expanded={folders.savedExpanded} controls={savedId} onClick={folders.toggleSaved} /></h3>
        <div id={savedId} hidden={!folders.savedExpanded}>{folders.savedExpanded && groups.saved.map(playlistRow)}</div>
      </section>}
      {status?.loading && <p className="loading">{tr("正在读取歌单…")}</p>}
      {page && !items.length && !status?.loading && <p className="muted">{tr("当前账号暂无歌单。")}</p>}
      {page?.nextCursor && <button disabled={status?.loading} onClick={() => s.sourcePlaylists.more(instanceId)}>{tr("加载更多歌单")}</button>}
      {!management && page && <p className="muted">{tr("平台未提供列表版本；翻页期间内容可能变化。")}{" "}
        {tr("观测时间：{0}", { 0: formatDate(page.observedAt) })}</p>}
    </div>
    {editing && accountId && <PlaylistLinkDialog
      target={editing.link ?? { instanceId, accountId, externalId: editing.playlist.externalId }} linkedId={editing.link?.playlistId}
      title={editing.playlist.title} changed={links.reload} close={() => setEditing(null)} />}
  </section>;
}
