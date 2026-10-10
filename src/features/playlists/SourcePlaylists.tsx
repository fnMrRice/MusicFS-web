import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { useServices, useStore } from "../../app/services";
import { usePages, useResource } from "../../components/query";
import { useMusicSources, useSourceName } from "../../components/use-source-name";
import { Cover, Empty, ErrorNotice } from "../../components/ui";
import { formatDate, tr, useLocale } from "../../i18n";
import { ApiError } from "../../api/client";

export function SourcePlaylists() {
  const { instance = "" } = useParams();
  const s = useServices();
  const sourceName = useSourceName();
  const providers = useResource("source-playlist-providers", (signal) => s.libraryApi.providers(signal));
  const online = useResource("source-playlist-instances", (signal) => s.content.online(signal));
  const source = useMusicSources().find((item) => item.id === instance);
  const revisions = useStore(s.sourcePlaylists.revisions);
  const label = sourceName(source?.online ?? source?.provider ?? instance);
  const supported = source?.online?.capabilities.some((c) => c.name === "playlist.list" && c.supported);
  return <section>
    <p className="eyebrow">{tr("来源歌单")}</p>
    <h2>{tr("{0} 的歌单", { 0: label })}</h2>
    <ErrorNotice error={providers.error} retry={providers.reload} />
    <ErrorNotice error={online.error} retry={online.reload} />
    {!source ? (providers.loading || online.loading)
      ? <p className="loading">{tr("正在读取来源…")}</p>
      : <Empty title={tr("暂无音乐来源")} icon="folder">{tr("此来源不可用，请刷新来源或检查服务端配置。")}</Empty>
      : source.online?.availability === "loginRequired"
        ? <p className="notice">{tr("请先在设置中登录此音乐平台，再读取账号歌单。")}{" "}<Link to="/settings">{tr("设置")}</Link></p>
        : source.online?.availability === "offline" || source.provider?.availability === "offline"
          ? <p className="notice">{tr("来源暂时离线，请稍后重试。")}</p>
          : !supported
            ? <p className="notice">{tr("此来源尚不支持读取账号歌单。")}</p>
            : <AccountPlaylists key={`${instance}:${revisions[instance] ?? 0}`} instance={instance} />}
  </section>;
}

function AccountPlaylists({ instance }: { instance: string }) {
  const s = useServices();
  useLocale();
  const [observedAt, setObservedAt] = useState("");
  const page = usePages(`account-playlists:${instance}`, async (cursor, signal) => {
    const generation = s.sourcePlaylists.generation(instance);
    let result;
    try {
      result = cursor ? await s.content.accountPlaylists(instance, cursor, signal) : await s.sourcePlaylists.first(instance);
    } catch (error) {
      if (!signal.aborted) s.sourcePlaylists.failed(instance, generation);
      throw error;
    }
    if (generation !== s.sourcePlaylists.generation(instance)) throw new ApiError("CANCELLED", "Account changed");
    if (!signal.aborted) {
      setObservedAt(result.observedAt);
      if (!cursor) s.sourcePlaylists.accept(instance, result, generation);
    }
    return { items: result.items, cursor: result.nextCursor };
  }, (playlist) => playlist.externalId);
  return <>
    <button onClick={() => s.sourcePlaylists.refresh(instance)}>{tr("刷新歌单")}</button>
    <p className="muted">{tr("从当前登录账号读取歌单，打开歌单不会自动导入。")}</p>
    <p className="muted">{tr("平台未提供列表版本；翻页期间内容可能变化。")}{observedAt && ` ${tr("观测时间：{0}", { 0: formatDate(observedAt) })}`}</p>
    <ErrorNotice error={page.error} retry={() => s.sourcePlaylists.refresh(instance)} />
    <div className="cards">{page.items.map((playlist) => <Link
      className="music-card" key={playlist.externalId}
      to={`/discover/${encodeURIComponent(instance)}/${encodeURIComponent(playlist.externalId)}`}>
      <Cover large />
      <strong>{playlist.title}</strong>
      <small>{tr("{0} 首", { 0: playlist.trackCount ?? tr("未知数量") })}</small>
    </Link>)}</div>
    {page.loading && <p className="loading">{tr("正在读取歌单…")}</p>}
    {!page.loading && !page.error && !page.items.length && <p>{tr("当前账号暂无歌单。")}</p>}
    {page.cursor && !page.error && <button disabled={page.loading} onClick={page.more}>{tr("加载更多歌单")}</button>}
  </>;
}
