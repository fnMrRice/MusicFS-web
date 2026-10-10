import { useState, type KeyboardEvent } from "react";
import { DirectoriesApi, type DirectoryItem, type MusicRoot } from "../../api/directories";
import { ErrorNotice, Icon } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { useDirectoryListing } from "./useDirectoryListing";

interface Selection {
  api: DirectoriesApi;
  disabled: boolean;
  roots: MusicRoot[];
  toggle: (item: DirectoryItem) => void;
}

export function DirectoryTree(props: Selection) {
  useLocale();
  return <div className="directory-tree">
    <DirectoryBranch {...props} path={null} />
  </div>;
}

function DirectoryBranch({ path, ...props }: Selection & { path: string | null }) {
  const listing = useDirectoryListing(props.api, path);
  const { page, error, loading } = listing;
  return <>
    <ErrorNotice error={error} retry={listing.retry} />
    {loading && <p className="directory-tree-message" role="status">{tr("正在读取目录…")}</p>}
    {page && !page.items.length && !page.nextCursor && <p className="muted directory-tree-message">{tr(path
      ? "此目录没有可浏览的子目录。" : "没有允许访问的目录，请在服务端配置目录访问权限。")}</p>}
    <ul role={path === null ? "tree" : "group"} aria-label={path === null ? tr("允许访问的目录") : undefined}
      aria-multiselectable={path === null ? true : undefined} className="directory-tree-branch">
      {page?.items.map((item) => <DirectoryNode {...props} key={item.path} item={item} root={path === null} />)}
    </ul>
    {page?.nextCursor && <button type="button" className="directory-tree-more" disabled={loading || props.disabled || !!error}
      onClick={() => void listing.browse(path, true)}>{tr("加载更多目录")}</button>}
  </>;
}

function DirectoryNode({ item, root, ...props }: Selection & { item: DirectoryItem; root: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const checked = props.roots.some((selected) => selected.path === item.path || selected.id === item.configuredRootId);
  const disabled = props.disabled || !item.available;
  function keyDown(event: KeyboardEvent<HTMLLIElement>) {
    if (event.target !== event.currentTarget) return;
    const element = event.currentTarget;
    const items = [...element.closest('[role="tree"]')!.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const index = items.indexOf(element);
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1);
      items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
    } else if (event.key === "ArrowRight" && item.available) {
      event.preventDefault();
      if (!expanded) setExpanded(true); else element.querySelector<HTMLElement>('[role="treeitem"]')?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (expanded) setExpanded(false); else element.parentElement?.closest<HTMLElement>('[role="treeitem"]')?.focus();
    } else if ((event.key === " " || event.key === "Enter") && !disabled) {
      event.preventDefault();
      props.toggle(item);
    }
  }
  return <li role="treeitem" aria-label={item.name} aria-expanded={expanded} aria-selected={checked}
    aria-disabled={!item.available} tabIndex={0} onKeyDown={keyDown}>
    <div className={`directory-tree-row${checked ? " directory-selected" : ""}`}>
      <button type="button" className={`directory-expand${expanded ? " expanded" : ""}`} disabled={!item.available}
        aria-label={tr(expanded ? "收起目录 {0}" : "展开目录 {0}", { 0: item.name })}
        onClick={() => setExpanded(!expanded)}><Icon name="chevron" size={17} /></button>
      <label className="directory-tree-choice">
        <input type="checkbox" aria-label={tr("选择目录 {0}", { 0: item.name })} disabled={disabled}
          checked={checked} onChange={() => props.toggle(item)} />
        <Icon name="folder" size={19} />
        <span className="directory-detail"><span title={item.path}>{item.name}</span>
          {root && <code>{item.path}</code>}
          {!item.available && <span className="muted">{tr("目录不存在或无法访问")}</span>}
        </span>
      </label>
    </div>
    {expanded && <DirectoryBranch {...props} path={item.path} />}
  </li>;
}
