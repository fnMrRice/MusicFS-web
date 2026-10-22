import type { ContentType, WorkInput } from "../../api/works";
import { tr } from "../../i18n";

export function WorkMetadataFields({ data, type, update }: {
  data: WorkInput; type: ContentType; update: (patch: Partial<WorkInput>) => void;
}) {
  return <>
    {(data.credits.some((credit) => !type.creditRoles.some((role) => role.id === credit.role)) ||
      data.externalIds.some((external) => !type.externalIdNamespaces.some((namespace) => namespace.id === external.namespace))) &&
      <p className="notice">{tr("有署名角色或编号来源已不在当前内容类型声明中，请调整或移除后保存。")}</p>}
    <section aria-label={tr("作品署名")}>
      <h3>{tr("作品署名")}</h3>
      {data.credits.map((credit, index) => <div className="work-field-row" key={index}>
        <label>{tr("署名角色 {0}", { 0: index + 1 })}
          <select aria-label={tr("署名角色 {0}", { 0: index + 1 })} value={credit.role} onChange={(event) => update({ credits: data.credits.map((item, i) =>
            i === index ? { ...item, role: event.target.value } : item) })}>
            {!type.creditRoles.some((role) => role.id === credit.role) &&
              <option value={credit.role}>{tr("未声明角色：{0}", { 0: credit.role })}</option>}
            {type.creditRoles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}
          </select>
        </label>
        <label>{tr("署名名称 {0}", { 0: index + 1 })}
          <input required maxLength={256} value={credit.name} onChange={(event) => update({
            credits: data.credits.map((item, i) => i === index ? { ...item, name: event.target.value } : item),
          })} />
        </label>
        <button type="button" aria-label={tr("移除署名 {0}", { 0: index + 1 })}
          onClick={() => update({ credits: data.credits.filter((_, i) => i !== index) })}>{tr("移除")}</button>
      </div>)}
      <button type="button" disabled={!type.creditRoles.length || data.credits.length >= 128}
        onClick={() => update({ credits: [...data.credits, { role: type.creditRoles[0].id, name: "" }] })}>
        {tr("添加署名")}
      </button>
    </section>
    <section aria-label={tr("外部编号")}>
      <h3>{tr("外部编号")}</h3>
      {data.externalIds.map((external, index) => <div className="work-field-row" key={index}>
        <label>{tr("编号来源 {0}", { 0: index + 1 })}
          <select aria-label={tr("编号来源 {0}", { 0: index + 1 })} value={external.namespace} onChange={(event) => update({
            externalIds: data.externalIds.map((item, i) => i === index ? { ...item, namespace: event.target.value } : item),
          })}>
            {!type.externalIdNamespaces.some((namespace) => namespace.id === external.namespace) &&
              <option value={external.namespace}>{tr("未声明来源：{0}", { 0: external.namespace })}</option>}
            {type.externalIdNamespaces.map((namespace) => <option value={namespace.id} key={namespace.id}>{namespace.name}</option>)}
          </select>
        </label>
        <label>{tr("编号值 {0}", { 0: index + 1 })}
          <input required maxLength={256} value={external.value} onChange={(event) => update({
            externalIds: data.externalIds.map((item, i) => i === index ? { ...item, value: event.target.value } : item),
          })} />
        </label>
        <button type="button" aria-label={tr("移除编号 {0}", { 0: index + 1 })}
          onClick={() => update({ externalIds: data.externalIds.filter((_, i) => i !== index) })}>{tr("移除")}</button>
      </div>)}
      <button type="button" disabled={!type.externalIdNamespaces.length || data.externalIds.length >= 32}
        onClick={() => update({ externalIds: [...data.externalIds, { namespace: type.externalIdNamespaces[0].id, value: "" }] })}>
        {tr("添加编号")}
      </button>
    </section>
  </>;
}
