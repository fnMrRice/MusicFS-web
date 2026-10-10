import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { DirectoriesApi, type DirectoryItem, type DirectoryPage } from "../../api/directories";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { directoryError } from "./errors";

export function DirectoryBrowser({ api, disabled, selectedPaths, selectedIds, select }: {
  api: DirectoriesApi;
  disabled: boolean;
  selectedPaths: string[];
  selectedIds: string[];
  select: (item: DirectoryItem) => void;
}) {
  useLocale();
  const [page, setPage] = useState<DirectoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const retry = useRef<() => void>(() => {});
  const cursors = useRef(new Set<string>());
  async function browse(path: string | null, append = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const cursor = append ? page?.nextCursor ?? null : null;
    if (!append) { cursors.current.clear(); setPage(null); }
    retry.current = () => { void browse(path, append); };
    setLoading(true);
    setError(null);
    try {
      const result = await api.browse(path, cursor, controller.signal);
      if (controller.signal.aborted) return;
      if (append && page?.revision !== result.revision)
        throw new ApiError("CURSOR_EXPIRED", "Directory listing changed");
      if (result.nextCursor && (result.nextCursor === cursor || cursors.current.has(result.nextCursor)))
        throw new ApiError("PAGINATION_STALLED", "Directory pagination stalled");
      if (cursor) cursors.current.add(cursor);
      setPage({ ...result, items: append
        ? [...new Map([...page!.items, ...result.items].map((item) => [item.path, item])).values()]
        : result.items });
    } catch (e) {
      if (!controller.signal.aborted) {
        const expired = e instanceof ApiError && (e.code === "CURSOR_EXPIRED" || append && e.code === "INVALID_ARGUMENT");
        setError(expired ? "目录列表已变化，请重新读取当前目录。" : directoryError(e));
        if (expired || e instanceof ApiError && e.code === "PAGINATION_STALLED")
          retry.current = () => { void browse(path); };
      }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    void browse(null);
    return () => request.current?.abort();
  }, [api]);
  const busy = loading || disabled;
  const current = page?.path;
  return <div className="directory-browser">
    <div className="directory-actions">
      <h4>{tr("允许访问的目录")}</h4>
      <button disabled={busy} onClick={() => void browse(null)}>{tr("返回允许目录")}</button>
      {current && <button disabled={busy} onClick={() => void browse(page.parentPath)}>{tr("上一级")}</button>}
    </div>
    <p className="muted">{tr("只能选择服务端允许访问的目录或其子目录。这里显示的是服务端的文件夹。")}</p>
    {current && <div className="directory-current">
      <code>{current}</code>
      <button disabled={busy || !!error || selectedPaths.includes(current) || !!page.configuredRootId && selectedIds.includes(page.configuredRootId)} onClick={() => select({
        name: current.split(/[\\/]/).filter(Boolean).at(-1) ?? current, path: current, available: true, configuredRootId: page.configuredRootId,
      })}>{tr("添加当前目录")}</button>
    </div>}
    <ErrorNotice error={error} retry={() => retry.current()} />
    {loading && <p role="status">{tr("正在读取目录…")}</p>}
    {page && !page.items.length && !page.nextCursor && <p className="muted">{tr(current
      ? "此目录没有可浏览的子目录。"
      : "没有允许访问的目录，请在服务端配置目录访问权限。")}</p>}
    <ul className="directory-list" aria-label={tr("可选目录")}>
      {page?.items.map((item) => <li key={item.path}>
        <div className="directory-detail"><strong>{item.name}</strong><code>{item.path}</code>
          {!item.available && <span className="muted">{tr("目录不存在或无法访问")}</span>}</div>
        <div className="directory-actions">
          <button disabled={busy || !item.available} aria-label={tr("打开目录 {0}", { 0: item.name })}
            onClick={() => void browse(item.path)}>{tr("打开目录")}</button>
          <button disabled={busy || !!error || !item.available || selectedPaths.includes(item.path) || !!item.configuredRootId && selectedIds.includes(item.configuredRootId)}
            aria-label={tr("添加目录 {0}", { 0: item.name })} onClick={() => select(item)}>{tr("添加目录")}</button>
        </div>
      </li>)}
    </ul>
    {page?.nextCursor && <button disabled={busy || !!error} onClick={() => void browse(page.path, true)}>{tr("加载更多目录")}</button>}
  </div>;
}
