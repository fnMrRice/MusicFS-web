import { tr, useLocale, formatDate, statusText } from "../i18n";
import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { useServices, useStore } from "../app/services";
import type { OnlineInstance } from "../api/content";
import { useResource } from "../components/query";
import { Cover, Empty, ErrorNotice, Icon, IconButton } from "../components/ui";
import { errorMessage } from "../api/client";
import { useSourceName } from "../components/use-source-name";
import { OnlinePlaylistTracks } from "./playlists/OnlinePlaylistTracks";
import { usePlaylistObservation } from "./playlists/usePlaylistObservation";
import { externalLink } from "./scrapers/fields";
import { useRecommendations } from "./useRecommendations";
import { DailySongs } from "./DailySongs";

function hasDailySongs(source: OnlineInstance) {
  return source.availability === "available" && !!source.accountId &&
    source.capabilities.some((capability) => capability.name === "recommendations.tracks" && capability.supported);
}

export function Recommendations() {
  const s = useServices();
  const { ready, session } = useStore(s.auth);
  const sources = useStore(s.content.onlineInstances);
  const scope = [ready?.instanceId, session?.user.id, sources.map((source) =>
    [source.instanceId, source.accountId, source.accountRevision, source.availability])];
  const dailySources = sources.filter(hasDailySongs);
  return <RecommendationFeed key={JSON.stringify(scope)} dailySources={dailySources} />;
}

function RecommendationFeed({ dailySources }: { dailySources: OnlineInstance[] }) {
  useLocale();
  const sourceName = useSourceName();
  const feed = useRecommendations(useServices().content);
  const daily = feed.offset === 0 ? dailySources : [];
  const recommendations = feed.page?.sources ?? [];
  // 有些账号只提供每日歌曲，公共歌单不可用时仍保留该账号的入口。
  const groups = [
    ...recommendations.map(source => ({
      source, result: source, showDaily: daily.some(account => account.instanceId === source.instanceId),
    })),
    ...daily.filter(account => !recommendations.some(source => source.instanceId === account.instanceId))
      .map(source => ({ source, result: undefined, showDaily: true })),
  ];
  return (
    <section>
      <div className="section-title recommendation-heading">
        <h2>{tr("推荐歌单")}</h2>
        <div className="recommendation-actions">
          <button type="button" aria-label={tr("时光机")} title={tr("时光机")}
            disabled={feed.loading || feed.offset >= (feed.page?.historyDepth ?? 0)}
            onClick={feed.previous}>
            <Icon name="clock" size={16} /><span>{tr("时光机")}</span>
          </button>
          <IconButton icon="refresh" label={tr("刷新推荐")} disabled={feed.loading} onClick={feed.refresh} />
        </div>
      </div>
      {feed.offset > 0 && (
        <div className="recommendation-history">
          <span className="muted" role="status">{tr("历史推荐（{0}/{1}）", { 0: feed.offset, 1: feed.page!.historyDepth })}</span>
          <button type="button" disabled={feed.loading} onClick={feed.showLatest}>{tr("返回最新推荐")}</button>
        </div>
      )}
      <ErrorNotice error={feed.error} retry={feed.retry} />
      {feed.loading && <p className="loading" role="status">{tr("正在寻找歌单…")}</p>}
      {groups.map(({ source, result, showDaily }) => (
        <section key={source.instanceId} className="source-section">
          <div className="section-title">
            <h3>{sourceName(source)}</h3>
          </div>
          {result?.stale && (
            <p className="notice">
              {tr("推荐已过期，正在展示上次成功获取的内容。")}
              {result.lastSuccessAt &&
                tr("上次成功：{0}", { "0": formatDate(result.lastSuccessAt) })}
            </p>
          )}
          {result?.error && (
            <p className="notice">
              {result.error.code === "PLATFORM_AUTH_REQUIRED" ? <>请先到<Link to="/settings">设置</Link>登录此音乐平台。</> : tr("此来源暂时无法获取推荐（{0}）。", { 0: result.error.code })}
              <button disabled={feed.loading} onClick={feed.refresh}>
                {tr("重试")}
              </button>
            </p>
          )}
          <div className="cards">
            {showDaily && <Link className="music-card" to={`/recommendations/${encodeURIComponent(source.instanceId)}/daily-songs`}>
              <span className="cover large"><Icon name="calendar" size={46} /></span>
              <strong>{tr("每日推荐歌曲")}</strong>
              <small>{sourceName(source)}</small>
            </Link>}
            {result?.items.map((item) => (
              <Link
                className="music-card"
                key={item.playlist.externalId}
                to={`/discover/${encodeURIComponent(source.instanceId)}/${encodeURIComponent(item.playlist.externalId)}`}
              >
                <Cover large src={externalLink(item.playlist.coverUrl ?? undefined)} />
                <strong>{item.playlist.title}</strong>
                <small>
                  {item.playlist.trackCount === null
                    ? sourceName(source)
                    : tr("{0} 首 · {1}", {
                        "0": item.playlist.trackCount,
                        "1": sourceName(source),
                      })}
                </small>
                {item.reason && <p>{item.reason}</p>}
              </Link>
            ))}
          </div>
          {!showDaily && !result?.items.length && !result?.error && (
            <p className="muted">{tr("此来源暂时没有推荐歌单。")}</p>
          )}
        </section>
      ))}
      {feed.page && groups.length === 0 && (
        <Empty title={tr("尚未配置可用的推荐来源。")} icon="home">
          <p>
            <Link className="button primary" to="/library">
              {tr("浏览音乐库")}
            </Link>
          </p>
        </Empty>
      )}
    </section>
  );
}
export function DiscoveryPlaylist({ daily = false }: { daily?: boolean }) {
  useLocale();
  const { instance = "", external = "" } = useParams();
  const s = useServices();
  const instances = useResource("source-playlist-instances", (signal) => s.content.online(signal));
  const source = useStore(s.content.onlineInstances).find((item) => item.instanceId === instance);
  if (!source) {
    if (instances.error) return <ErrorNotice error={instances.error} retry={instances.reload} />;
    return <p className="muted">{tr(instances.loading ? "正在读取来源…" : "此来源不可用，请刷新来源或检查服务端配置。")}</p>;
  }
  if (source.availability === "loginRequired" || (!source.accountId && source.authentication !== "anonymous"))
    return <p className="notice">{tr("请先在设置中登录此音乐平台，再读取账号歌单。")}{" "}<Link to="/settings">{tr("设置")}</Link></p>;
  if (source.availability !== "available") return <p className="notice">{tr("来源暂时离线，请稍后重试。")}</p>;
  const key = JSON.stringify([instance, external, source.accountId, source.accountRevision]);
  if (daily) return hasDailySongs(source)
    ? <DailySongs key={key} source={source} />
    : <p className="notice">{tr("此来源尚不支持每日推荐歌曲。")}</p>;
  return <DiscoveryDetails key={key} source={source} external={external} />;
}
function DiscoveryDetails({ source, external }: { source: OnlineInstance; external: string }) {
  const s = useServices();
  const instance = source.instanceId;
  const query = usePlaylistObservation(s.content, source, external);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const importPlaylist = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await s.content.importRemote(instance, external);
      setMessage(
        result.merged
          ? "此歌单已经导入，可在歌单管理中同步和绑定。"
          : "已记录导入，可在歌单管理中同步和绑定。",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <ErrorNotice error={query.error} retry={query.retry} />
      {query.loading && <p className="loading">{tr("正在读取歌单…")}</p>}
      {query.data && (
        <>
          <div className="detail-heading">
            <Cover large src={externalLink(query.data.playlist.coverUrl ?? undefined)} />
            <div>
              <p className="eyebrow">{tr("在线歌单 · 只读预览")}</p>
              <h2>{query.data.playlist.title}</h2>
              <p className="muted">
                {tr("{0} 首", {
                  0: query.data.playlist.trackCount ?? tr("未知数量"),
                })}{" "}
                ·{" "}
                {query.data.complete
                  ? tr("本次读取完整")
                  : tr("本次读取不完整")}
              </p>
              <div className="list-actions">
                <button type="button" className="primary" disabled={busy || !!message} onClick={() => void importPlaylist()}>
                  {busy ? tr("正在导入…") : tr("导入到歌单管理")}
                </button>
                <button type="button" onClick={query.refresh}>{tr("刷新歌单")}</button>
              </div>
            </div>
          </div>
          <p className="muted">
            {tr("本次观测到 {0} 个曲目引用。", {
              0: query.data.entries.length,
            })}
            {query.data.observedAt &&
              tr("观测时间：{0}", { "0": formatDate(query.data.observedAt) })}
          </p>
          <OnlinePlaylistTracks key={query.data.observedAt} source={source} external={external} />
        </>
      )}
      {message && (
        <p role="status" className="notice">
          {statusText(message)} <Link to="/playlists">{tr("前往管理")}</Link>
        </p>
      )}
      <ErrorNotice error={error} />
    </section>
  );
}
