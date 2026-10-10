import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useServices } from "../app/services";
import { useResource, usePages } from "../components/query";
import {
  Cover,
  Empty,
  ErrorNotice,
  IconButton,
  Sentinel,
} from "../components/ui";
import { TrackTable } from "./TrackTable";
import { scanStatusMessage } from "../library/scan-state";

export function Library() {
  const s = useServices();
  const [params, setParams] = useSearchParams();
  const provider = params.get("source") || "all";
  const category = params.get("category") || "全部曲目";
  const providers = useResource("providers", (signal) =>
    s.libraryApi.providers(signal),
  );
  const state = useMemo(() => s.library(provider), [s, provider]);
  const subscribe = useMemo(
    () => (listener: () => void) => {
      state.onChange = listener;
      return () => {
        state.onChange = null;
      };
    },
    [state],
  );
  const snapshot = useSyncExternalStore(subscribe, () => state.snapshot);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!state.snapshot.revision) void state.select(provider);
    return () => state.cancel();
  }, [provider, state]);
  const refresh = () => {
    setRevision((v) => v + 1);
    providers.reload();
    void state.refresh();
  };
  const statuses = (providers.data ?? [])
    .filter((p) => provider === "all" || p.id === provider)
    .map((p) => [p.name, scanStatusMessage(p)])
    .filter(([, message]) => message);
  return (
    <section aria-label="音乐文件">
      <div className="tabs" aria-label="曲目分类">
        {["全部曲目", "歌手", "专辑", "流派", "文件夹"].map((c) => (
          <button
            key={c}
            aria-pressed={category === c}
            className={category === c ? "active" : ""}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("category", c);
              setParams(next);
            }}
          >
            {c}
          </button>
        ))}
      </div>
      {category === "专辑" ? (
        <Albums />
      ) : category !== "全部曲目" ? (
        <Empty
          title={`${category}分类待支持`}
          icon={category === "歌手" ? "user" : "folder"}
        >
          服务端尚未提供完整的{category}分类接口。你仍可浏览全部曲目。
        </Empty>
      ) : (
        <>
          <div className="filters">
            <select
              aria-label="来源"
              value={provider}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set("source", e.target.value);
                setParams(next);
              }}
            >
              <option value="all">全部来源</option>
              {providers.data?.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="格式筛选"
              disabled
              title="等待服务端提供全库格式筛选"
            >
              <option>全部格式</option>
            </select>
            <label className="check-label" title="等待收藏接口">
              <input type="checkbox" disabled />
              仅收藏
            </label>
            <label className="check-label" title="等待服务端提供全库可播放过滤">
              <input type="checkbox" disabled />
              仅可播放
            </label>
            <button disabled title="等待服务端提供组合筛选">
              更多筛选
            </button>
            <div className="filter-end">
              <input
                placeholder="搜索当前列表"
                aria-label="搜索当前列表"
                disabled
                title="等待服务端提供全库关键词查询"
              />
              <IconButton icon="refresh" label="刷新列表" onClick={refresh} />
            </div>
          </div>
          <ErrorNotice error={providers.error} retry={providers.reload} />
          {statuses.map(([name, message]) => (
            <p className="notice" key={name}>
              {name}：{message}
            </p>
          ))}
          {snapshot.items.length > 0 && (
            <TrackTable
              tracks={snapshot.items}
              providers={providers.data ?? []}
              queryKey={`${provider}:${revision}`}
              complete={
                !snapshot.cursor && !snapshot.loading && !snapshot.error
              }
            />
          )}
          <ErrorNotice
            error={snapshot.error}
            retry={() => {
              if (snapshot.cursor) void state.more();
              else refresh();
            }}
          />
          {snapshot.loading && (
            <div className="loading" role="status">
              正在加载…
            </div>
          )}
          {!snapshot.loading && !snapshot.items.length && !snapshot.error && (
            <Empty title="音乐库还很安静">
              将音乐目录接入服务并完成扫描后，曲目会出现在这里。
              <p>
                <button onClick={refresh}>刷新音乐库</button>
              </p>
            </Empty>
          )}
          <Sentinel
            active={!!snapshot.cursor && !snapshot.loading && !snapshot.error}
            load={() => {
              void state.more();
            }}
          />
        </>
      )}
    </section>
  );
}
function Albums() {
  const s = useServices();
  const pages = usePages(
    "albums",
    async (after, signal) => {
      const p = await s.content.albums(after, signal);
      return { items: p.items, cursor: p.nextAfter };
    },
    (a) => a.sourceAlbumId,
  );
  return (
    <>
      <div className="cards">
        {pages.items.map((a) => (
          <Link
            className="music-card"
            key={a.sourceAlbumId}
            to={`/albums/${encodeURIComponent(a.sourceAlbumId)}`}
          >
            <Cover large />
            <strong>{a.name}</strong>
            <small>
              {a.sourceTrackIds.length} 首 · {a.providerInstanceId}
            </small>
          </Link>
        ))}
      </div>
      <ErrorNotice error={pages.error} retry={pages.retry} />
      {pages.loading && <p className="loading">正在加载…</p>}
      {!pages.loading && !pages.error && !pages.items.length && (
        <Empty title="暂无专辑">服务端尚未整理可浏览的专辑。</Empty>
      )}
      <Sentinel
        active={!!pages.cursor && !pages.loading && !pages.error}
        load={pages.more}
      />
    </>
  );
}
