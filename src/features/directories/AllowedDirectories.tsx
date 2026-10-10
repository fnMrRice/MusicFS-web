import { DirectoriesApi } from "../../api/directories";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { useDirectoryListing } from "./useDirectoryListing";

export function AllowedDirectories({ api }: { api: DirectoriesApi }) {
  useLocale();
  const { page, loading, error, browse, retry } = useDirectoryListing(api);
  return <section className="allowed-directories" aria-label={tr("目录访问范围")}>
    <div className="directory-actions">
      <h4>{tr("允许访问的目录")}</h4><span className="muted">{tr("只读")}</span>
    </div>
    <p className="muted">{tr("访问范围由服务端配置，只读展示；这些目录不会自动加入导入目录。")}</p>
    <ErrorNotice error={error} retry={retry} />
    {loading && <p role="status">{tr("正在读取目录…")}</p>}
    {page && !page.items.length && !page.nextCursor && <p className="muted">
      {tr("没有允许访问的目录，请在服务端配置目录访问权限。")}</p>}
    <ul className="directory-list" aria-label={tr("允许访问的目录")}>
      {page?.items.map((item) => <li key={item.path}>
        <div className="directory-detail"><strong>{item.name}</strong><code>{item.path}</code>
          {!item.available && <span className="muted">{tr("目录不存在或无法访问")}</span>}</div>
      </li>)}
    </ul>
    {page?.nextCursor && <button disabled={loading || !!error} onClick={() => void browse(null, true)}>
      {tr("加载更多目录")}</button>}
  </section>;
}
