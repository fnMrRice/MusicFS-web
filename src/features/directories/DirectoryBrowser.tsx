import { DirectoriesApi, type DirectoryItem } from "../../api/directories";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { useDirectoryListing } from "./useDirectoryListing";

export function DirectoryBrowser({ api, disabled, selectedPaths, selectedIds, selected, select }: {
  api: DirectoriesApi;
  disabled: boolean;
  selectedPaths: string[];
  selectedIds: string[];
  selected: DirectoryItem | null;
  select: (item: DirectoryItem | null) => void;
}) {
  useLocale();
  const listing = useDirectoryListing(api);
  const { page, loading, error } = listing;
  function browse(path: string | null, append = false) {
    select(null);
    void listing.browse(path, append);
  }
  const busy = loading || disabled;
  const current = page?.path;
  return <div className="directory-browser">
    <div className="directory-actions">
      <h4>{tr(current ? "子目录" : "允许访问的目录")}</h4>
      <button disabled={busy} onClick={() => void browse(null)}>{tr("返回允许目录")}</button>
      {current && <button disabled={busy} onClick={() => void browse(page.parentPath)}>{tr("上一级")}</button>}
    </div>
    {current && <div className="directory-current">
      <code>{current}</code>
      <button aria-pressed={selected?.path === current} disabled={busy || !!error || selectedPaths.includes(current) || !!page.configuredRootId && selectedIds.includes(page.configuredRootId)} onClick={() => select({
        name: current.split(/[\\/]/).filter(Boolean).at(-1) ?? current, path: current, available: true, configuredRootId: page.configuredRootId,
      })}>{tr("选择当前目录")}</button>
    </div>}
    <ErrorNotice error={error} retry={() => { select(null); listing.retry(); }} />
    {loading && <p role="status">{tr("正在读取目录…")}</p>}
    {page && !page.items.length && !page.nextCursor && <p className="muted">{tr(current
      ? "此目录没有可浏览的子目录。"
      : "没有允许访问的目录，请在服务端配置目录访问权限。")}</p>}
    <ul className="directory-list" aria-label={tr("可选目录")}>
      {page?.items.map((item) => <li key={item.path} className={selected?.path === item.path ? "directory-selected" : undefined}>
        <div className="directory-detail"><strong>{item.name}</strong><code>{item.path}</code>
          {!item.available && <span className="muted">{tr("目录不存在或无法访问")}</span>}</div>
        <div className="directory-actions">
          <button disabled={busy || !item.available} aria-label={tr("打开目录 {0}", { 0: item.name })}
            onClick={() => void browse(item.path)}>{tr("打开目录")}</button>
          <button aria-pressed={selected?.path === item.path} disabled={busy || !!error || !item.available || selectedPaths.includes(item.path) || !!item.configuredRootId && selectedIds.includes(item.configuredRootId)}
            aria-label={tr("选择目录 {0}", { 0: item.name })} onClick={() => select(item)}>{tr("选择目录")}</button>
        </div>
      </li>)}
    </ul>
    {page?.nextCursor && <button disabled={busy || !!error} onClick={() => void browse(page.path, true)}>{tr("加载更多目录")}</button>}
  </div>;
}
