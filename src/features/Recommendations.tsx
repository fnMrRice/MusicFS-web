import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { useServices } from "../app/services";
import { useResource } from "../components/query";
import { Cover, Empty, ErrorNotice, IconButton } from "../components/ui";
import { errorMessage } from "../api/client";
export function Recommendations() {
  const s = useServices();
  const [refresh, setRefresh] = useState(0);
  const query = useResource(`recommendations:${refresh}`, (signal) =>
    s.content.recommendations(refresh > 0, signal),
  );
  return (
    <section>
      <div className="hero">
        <div>
          <p className="eyebrow">A LITTLE DISCOVERY, EVERY DAY</p>
          <h2>让好音乐，不期而遇。</h2>
          <p>来自你所连接来源的歌单推荐。</p>
        </div>
        <div className="hero-record" aria-hidden="true" />
      </div>
      <div className="section-title">
        <h2>为你发现</h2>
        <IconButton
          icon="refresh"
          label="刷新推荐"
          onClick={() => setRefresh((v) => v + 1)}
        />
      </div>
      <ErrorNotice error={query.error} retry={query.reload} />
      {query.loading && <p className="loading">正在寻找歌单…</p>}
      {query.data?.map((source) => (
        <section key={source.instanceId} className="source-section">
          <div className="section-title">
            <h3>{source.name}</h3>
            <span className="muted">公共推荐 · 匿名</span>
          </div>
          {source.stale && (
            <p className="notice">
              推荐已过期，正在展示上次成功获取的内容。
              {source.lastSuccessAt &&
                `上次成功：${new Date(source.lastSuccessAt).toLocaleString("zh-CN")}`}
            </p>
          )}
          {source.error && (
            <p className="notice">
              此来源暂时无法获取推荐（{source.error.code}）。
              <button onClick={() => setRefresh((v) => v + 1)}>重试</button>
            </p>
          )}
          <div className="cards">
            {source.items.map((item) => (
              <Link
                className="music-card"
                key={item.playlist.externalId}
                to={`/discover/${encodeURIComponent(source.instanceId)}/${encodeURIComponent(item.playlist.externalId)}`}
              >
                <Cover large />
                <strong>{item.playlist.title}</strong>
                <small>
                  {item.playlist.trackCount === null
                    ? source.name
                    : `${item.playlist.trackCount} 首 · ${source.name}`}
                </small>
                {item.reason && <p>{item.reason}</p>}
              </Link>
            ))}
          </div>
          {!source.items.length && !source.error && (
            <p className="muted">此来源暂时没有推荐歌单。</p>
          )}
        </section>
      ))}
      {query.data?.length === 0 && (
        <Empty title="先从你的音乐库开始" icon="home">
          尚未配置可用的推荐来源。
          <p>
            <Link className="button primary" to="/library">
              浏览音乐库
            </Link>
          </p>
        </Empty>
      )}
    </section>
  );
}
export function DiscoveryPlaylist() {
  const { instance = "", external = "" } = useParams();
  const s = useServices();
  const query = useResource(`${instance}:${external}`, (signal) =>
    s.content.observation(instance, external, signal),
  );
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
      <ErrorNotice error={query.error} retry={query.reload} />
      {query.loading && <p className="loading">正在读取歌单…</p>}
      {query.data && (
        <>
          <div className="detail-heading">
            <Cover large />
            <div>
              <p className="eyebrow">在线歌单 · 只读预览</p>
              <h2>{query.data.playlist.title}</h2>
              <p className="muted">
                {query.data.playlist.trackCount ?? "未知数量"} 首 ·{" "}
                {query.data.complete ? "本次读取完整" : "本次读取不完整"}
              </p>
              <button
                className="primary"
                disabled={busy || !!message}
                onClick={() => {
                  void importPlaylist();
                }}
              >
                {busy ? "正在导入…" : "导入到歌单管理"}
              </button>
            </div>
          </div>
          <p className="notice">
            打开歌单不会自动导入；当前在线来源不提供音频播放。曲目名称详情和完整浏览接口等待服务端完善。
          </p>
          <p className="muted">
            本次观测到 {query.data.entries.length} 个曲目引用。
            {query.data.observedAt &&
              `观测时间：${new Date(query.data.observedAt).toLocaleString("zh-CN")}`}
          </p>
        </>
      )}
      {message && (
        <p role="status" className="notice">
          {message} <Link to="/playlists">前往管理</Link>
        </p>
      )}
      <ErrorNotice error={error} />
    </section>
  );
}
