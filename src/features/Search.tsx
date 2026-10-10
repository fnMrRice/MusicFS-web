import { tr, useLocale } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useServices } from "../app/services";
import { SearchHistory } from "./SearchHistory";
import { usePages, useResource } from "../components/query";
import type { OnlineInstance } from "../api/content";
import { sourceName } from "../components/source-name";
import {
  Cover,
  duration,
  Empty,
  ErrorNotice,
  Icon,
  Sentinel,
} from "../components/ui";

export function Search() {
  useLocale();
  const s = useServices();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const type = params.get("type") || "曲目";
  const source = params.get("source") || "all";
  const [draft, setDraft] = useState(q);
  const composing = useRef(false);
  const [validation, setValidation] = useState("");
  const providers = useResource("search-instances", (signal) =>
    s.content.online(signal),
  );
  useEffect(() => {
    setDraft(q);
  }, [q]);
  const update = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(name, value);
    setParams(next);
  };
  const sources =
    providers.data?.filter(
      (p) => source === "all" || p.instanceId === source,
    ) ?? [];
  return (
    <section>
      <div className="search-heading">
        <p className="eyebrow">{tr("FIND YOUR NEXT FAVORITE")}</p>
        <h2>{tr("寻找此刻想听的音乐")}</h2>
        <p className="muted">{tr("探索已连接的音乐来源。")}</p>
      </div>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (composing.current) return;
          if (new TextEncoder().encode(draft.trim()).length > 256) {
            setValidation("关键词过长，请缩短后重试。");
            return;
          }
          setValidation("");
          update("q", draft.trim());
        }}
      >
        <Icon name="search" size={23} />
        <input
          aria-label={tr("搜索关键词")}
          value={draft}
          placeholder={tr("搜索曲目、专辑、歌手、歌单")}
          onChange={(e) => setDraft(e.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              (e.nativeEvent.isComposing || composing.current)
            )
              e.preventDefault();
          }}
        />
        {draft && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setDraft("");
              update("q", "");
            }}
          >
            {tr("清空")}
          </button>
        )}
        <button className="primary">{tr("搜索")}</button>
      </form>
      <ErrorNotice error={validation} />
      <SearchHistory query={q} choose={(value) => update("q", value)} />
      <div className="search-options">
        <label>
          {tr("搜索来源")}{" "}
          <select
            aria-label={tr("搜索来源")}
            value={source}
            onChange={(e) => update("source", e.target.value)}
          >
            <option value="all">{tr("全部来源")}</option>
            {providers.data?.map((p) => (
              <option value={p.instanceId} key={p.instanceId}>
                {sourceName(p)}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">{tr("保留各来源的结果顺序")}</span>
      </div>
      <div className="tabs">
        {["曲目", "专辑", "歌手", "歌单"].map((t) => (
          <button
            key={t}
            className={type === t ? "active" : ""}
            aria-pressed={type === t}
            onClick={() => update("type", t)}
          >
            {tr(t)}
          </button>
        ))}
      </div>
      <ErrorNotice error={providers.error} retry={providers.reload} />
      {providers.loading && <p className="loading">{tr("正在读取来源…")}</p>}
      {type !== "曲目" ? (
        <Empty
          title={tr("{0}搜索即将接入", { "0": tr(type) })}
          icon={type === "歌手" ? "user" : "album"}
        >
          {tr(
            "当前服务端尚未提供{0}搜索接口。页面入口已保留，关键词不会丢失。",
            { 0: tr(type) },
          )}
        </Empty>
      ) : !q ? (
        <Empty title={tr("从一个名字开始")} icon="search">
          {tr("输入歌曲或歌手名称，按 Enter 开始搜索。")}
          <p>{tr("本地音乐库关键词搜索仍待服务端支持。")}</p>
        </Empty>
      ) : !providers.loading && !providers.error && !sources.length ? (
        <Empty title={tr("暂无在线搜索来源")} icon="search">
          {tr("可在音乐库浏览本地曲目；在线来源需要在服务端配置。")}
        </Empty>
      ) : (
        sources.map((p) => (
          <SearchSource key={`${p.instanceId}:${q}`} provider={p} query={q} />
        ))
      )}
    </section>
  );
}
function SearchSource({
  provider,
  query,
}: {
  provider: OnlineInstance;
  query: string;
}) {
  useLocale();
  const supported = provider.capabilities.find(
    (c) => c.name === "search.tracks",
  );
  return (
    <section className="source-section">
      <div className="section-title">
        <h2>{sourceName(provider)}</h2>
        <span className="badge">
          {provider.availability === "available"
            ? tr("在线来源")
            : provider.availability === "loginRequired" ? "需要平台登录" : tr("来源离线")}
        </span>
      </div>
      {provider.availability === "loginRequired" ? (
        <p className="notice">请先到<a href="#/settings">设置</a>登录此音乐平台，再使用在线搜索。</p>
      ) : !supported?.supported ? (
        <p className="notice">{tr("此来源尚不支持曲目搜索。")}</p>
      ) : provider.availability !== "available" ? (
        <p className="notice">{tr("来源暂时离线，请稍后重试。")}</p>
      ) : (
        <SearchResults instance={provider.instanceId} query={query} />
      )}
    </section>
  );
}
function SearchResults({
  instance,
  query,
}: {
  instance: string;
  query: string;
}) {
  useLocale();
  const s = useServices();
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const ref = useRef<HTMLInputElement>(null);
  const page = usePages(
    `${instance}:${query}`,
    async (cursor, signal) => {
      const result = await s.content.search(instance, query, cursor, signal);
      if (!signal.aborted) setTruncated(result.truncated);
      return { items: result.tracks, cursor: result.nextCursor };
    },
    (t) => t.externalId,
  );
  const all =
    !!page.items.length && page.items.every((t) => selected.has(t.externalId));
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selected.size > 0 && !all;
  }, [selected, all]);
  return (
    <>
      <div className="list-actions">
        {selected.size > 0 && (
          <strong>{tr("已选择 {0} 首", { 0: selected.size })}</strong>
        )}
        <button disabled title={tr("当前在线接口仅提供资料，不提供播放授权")}>
          {tr("播放结果")}
        </button>
        <button disabled title={tr("等待在线曲目播放及完整结果解析能力")}>
          {tr("加入队列")}
        </button>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())}>
            {tr("清空选择")}
          </button>
        )}
        <span className="muted">
          {tr("在线搜索结果仅供查看，播放能力尚未开放。")}
        </span>
      </div>
      {!!page.items.length && (
        <div className="table-wrap">
          <table className="tracks">
            <thead>
              <tr>
                <th>
                  <input
                    ref={ref}
                    aria-label={tr("全选当前已返回搜索结果")}
                    type="checkbox"
                    checked={all}
                    onChange={() =>
                      setSelected(
                        all
                          ? new Set()
                          : new Set(page.items.map((t) => t.externalId)),
                      )
                    }
                  />
                </th>
                <th>{tr("曲名")}</th>
                <th>{tr("歌手")}</th>
                <th>{tr("专辑")}</th>
                <th>{tr("时长")}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((t) => (
                <tr key={t.externalId}>
                  <td>
                    <input
                      aria-label={tr("选择 {0}", { "0": t.title })}
                      type="checkbox"
                      checked={selected.has(t.externalId)}
                      onChange={() =>
                        setSelected((old) => {
                          const n = new Set(old);
                          if (n.has(t.externalId)) n.delete(t.externalId);
                          else n.add(t.externalId);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td>
                    <div className="track-title">
                      <Cover />
                      <strong>{t.title}</strong>
                    </div>
                  </td>
                  <td>{t.artists.join(" / ") || "—"}</td>
                  <td>{t.album || "—"}</td>
                  <td>{duration(t.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorNotice error={page.error} retry={page.retry} />
      {page.loading && <p className="loading">{tr("正在搜索…")}</p>}
      {!page.loading && !page.error && !page.items.length && (
        <Empty title={tr("没有找到相关曲目")} icon="search">
          {tr("换一个关键词试试。")}
        </Empty>
      )}
      {truncated && (
        <p className="notice">
          {tr("来源限制了可返回的结果，尝试更精确的关键词。")}
        </p>
      )}
      <Sentinel
        active={!!page.cursor && !page.loading && !page.error}
        load={page.more}
      />
    </>
  );
}
