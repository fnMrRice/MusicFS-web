import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { WorksApi } from "../../api/works";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { WorkEditor } from "./WorkEditor";
import { WorkPackages } from "./packages/WorkPackages";
import "./works.css";

export function WorkDetail() {
  useLocale();
  const { id = "" } = useParams();
  const [query, setQuery] = useSearchParams();
  const initialKind = query.get("packageKind") === "cd_dump" ? "cd_dump" : "directory";
  const services = useServices();
  const api = useMemo(() => new WorksApi(services.client), [services]);
  const resource = useResource(`work:${id}`, (signal) => api.get(id, signal));
  const types = useResource(`work-detail-types:${id}`, (signal) => api.types(signal));
  const [editing, setEditing] = useState(false);
  const work = resource.data;
  const type = types.data?.find((item) => item.id === work?.contentType);
  return <section className="works-page" aria-label={tr("作品详情")}>
    <Link className="button" to={initialKind === "cd_dump" ? "/works?packageKind=cd_dump" : "/works"}>{tr("返回作品库")}</Link>
    <ErrorNotice error={resource.error} retry={resource.reload} />
    <ErrorNotice error={types.error} retry={types.reload} />
    {resource.loading && <p role="status">{tr("正在加载…")}</p>}
    {work && <>
      <div className="work-heading">
        <div><p className="work-type">{type?.name ?? work.contentType}</p><h2>{work.title}</h2></div>
        <div className="work-actions">
          <button disabled={!type || types.loading} onClick={() => setEditing(true)}>{tr("编辑作品资料")}</button>
          <button onClick={() => { setEditing(false); resource.reload(); types.reload(); }}>{tr("刷新资料")}</button>
        </div>
      </div>
      {!types.loading && !type && <p className="notice">{tr("此作品的内容类型当前不可用，已有资料可以阅读，编辑暂不可用。")}</p>}
      <div className="work-detail-grid">
        <section className="work-panel"><h3>{tr("作品简介")}</h3>
          <p className="work-description">{work.description || tr("尚未填写简介。")}</p>
          {!!work.tags.length && <div className="work-tags">{work.tags.map((tag) => <Link key={tag}
            to={`/works?tag=${encodeURIComponent(tag)}`}>{tag}</Link>)}</div>}
        </section>
        <div>
          <section className="work-panel"><h3>{tr("作品署名")}</h3>
            {work.credits.length ? <dl>{work.credits.map((credit, index) => <div key={index}>
              <dt>{type?.creditRoles.find((role) => role.id === credit.role)?.name ?? credit.role}</dt>
              <dd>{credit.name}</dd>
            </div>)}</dl> : <p className="muted">{tr("尚未填写署名。")}</p>}
          </section>
          <section className="work-panel"><h3>{tr("外部编号")}</h3>
            {work.externalIds.length ? <dl>{work.externalIds.map((external, index) => <div key={index}>
              <dt>{type?.externalIdNamespaces.find((namespace) => namespace.id === external.namespace)?.name ?? external.namespace}</dt>
              <dd>{external.value}</dd>
            </div>)}</dl> : <p className="muted">{tr("尚未填写编号。")}</p>}
          </section>
        </div>
      </div>
      <WorkPackages key={work.workId} workId={work.workId} editable={!!type && !types.loading} initialKind={initialKind}
        autoImport={query.get("import") === "1"} importOpened={() => {
          const next = new URLSearchParams(query); next.delete("import"); setQuery(next, { replace: true });
        }} />
      {editing && type && <WorkEditor api={api} types={types.data ?? []} work={work}
        close={() => setEditing(false)} refresh={resource.reload}
        saved={() => { setEditing(false); resource.reload(); }} />}
    </>}
  </section>;
}
