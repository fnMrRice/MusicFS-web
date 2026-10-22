import { tr, useLocale, statusText } from "../i18n";
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
import { useSourceName } from "../components/use-source-name";
import { Candidates } from "./matching/Candidates";
import { MatchingRecovery } from "./matching/MatchingRecovery";
import { BulkMergeButton } from "./matching/BulkMerge";

export function Library() {
  useLocale();
  const s = useServices();
  const sourceName = useSourceName();
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
  const [candidates, setCandidates] = useState(false);
  useEffect(() => {
    if (!state.snapshot.revision) void state.select(provider);
    else void state.refresh();
    return () => state.cancel();
  }, [provider, state]);
  const refresh = () => {
    setRevision((v) => v + 1);
    providers.reload();
    void state.refresh();
  };
  const statuses = (providers.data ?? [])
    .filter((p) => provider === "all" || p.id === provider)
    .map((p) => [sourceName(p), scanStatusMessage(p)])
    .filter(([, message]) => message);
  return (
    <section aria-label={tr("音乐文件")}>
      <div className="tabs" aria-label={tr("曲目分类")}>
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
            {tr(c)}
          </button>
        ))}
      </div>
      {category === "专辑" ? (
        <Albums />
      ) : category !== "全部曲目" ? (
        <Empty
          title={tr("{0}分类待支持", { "0": tr(category) })}
          icon={category === "歌手" ? "user" : "folder"}
        >
          {tr("服务端尚未提供完整的{0}分类接口。你仍可浏览全部曲目。", {
            0: tr(category),
          })}
        </Empty>
      ) : (
        <>
          <div className="filters">
            <select
              aria-label={tr("来源")}
              value={provider}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set("source", e.target.value);
                setParams(next);
              }}
            >
              <option value="all">{tr("全部来源")}</option>
              {providers.data?.map((p) => (
                <option value={p.id} key={p.id}>
                  {sourceName(p)}
                </option>
              ))}
            </select>
            <select
              aria-label={tr("格式筛选")}
              disabled
              title={tr("等待服务端提供全库格式筛选")}
            >
              <option>{tr("全部格式")}</option>
            </select>
            <label className="check-label" title={tr("等待收藏接口")}>
              <input type="checkbox" disabled />
              {tr("仅收藏")}
            </label>
            <label
              className="check-label"
              title={tr("等待服务端提供全库可播放过滤")}
            >
              <input type="checkbox" disabled />
              {tr("仅可播放")}
            </label>
            <button disabled title={tr("等待服务端提供组合筛选")}>
              {tr("更多筛选")}
            </button>
            <div className="filter-end">
              {snapshot.matchingRevision !== undefined && <BulkMergeButton />}
              {snapshot.matchingRevision !== undefined && <button onClick={() => setCandidates(true)}>{tr("重复识别")}</button>}
              <input
                placeholder={tr("搜索当前列表")}
                aria-label={tr("搜索当前列表")}
                disabled
                title={tr("等待服务端提供全库关键词查询")}
              />
              <IconButton
                icon="refresh"
                label={tr("刷新列表")}
                onClick={refresh}
              />
            </div>
          </div>
          <ErrorNotice error={providers.error} retry={providers.reload} />
          <MatchingRecovery />
          {statuses.map(([name, message]) => (
            <p className="notice" key={name}>
              {name}: {statusText(message ?? "")}
            </p>
          ))}
          {snapshot.items.length > 0 && (
            <TrackTable
              tracks={snapshot.items}
              providers={providers.data ?? []}
              queryKey={`${provider}:${revision}`}
              matchingRevision={snapshot.matchingRevision}
              onMatchingChange={snapshot.matchingRevision !== undefined ? refresh : undefined}
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
              {tr("正在加载…")}
            </div>
          )}
          {!snapshot.loading && !snapshot.items.length && !snapshot.error && (
            <Empty title={tr("音乐库还很安静")}>
              {tr("将音乐目录接入服务并完成扫描后，曲目会出现在这里。")}
              <p>
                <button onClick={refresh}>{tr("刷新音乐库")}</button>
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
      {candidates && <Candidates close={() => setCandidates(false)} refresh={refresh} />}
    </section>
  );
}
function Albums() {
  useLocale();
  const s = useServices();
  const sourceName = useSourceName();
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
              {tr("{0} 首 · {1}", {
                0: a.sourceTrackIds.length,
                1: sourceName(a.providerInstanceId),
              })}
            </small>
          </Link>
        ))}
      </div>
      <ErrorNotice error={pages.error} retry={pages.retry} />
      {pages.loading && <p className="loading">{tr("正在加载…")}</p>}
      {!pages.loading && !pages.error && !pages.items.length && (
        <Empty title={tr("暂无专辑")}>
          {tr("服务端尚未整理可浏览的专辑。")}
        </Empty>
      )}
      <Sentinel
        active={!!pages.cursor && !pages.loading && !pages.error}
        load={pages.more}
      />
    </>
  );
}
