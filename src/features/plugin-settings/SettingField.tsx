import { useId } from "react";
import type { PluginField, SettingValue } from "../../api/plugin-settings";
import { localizedPluginText } from "../../components/source-name";
import { tr, useLocale } from "../../i18n";

export function SettingField({ field, value, disabled, change }: {
  field: PluginField; value: SettingValue; disabled: boolean; change: (value: SettingValue) => void;
}) {
  const { locale } = useLocale();
  const id = useId();
  const label = localizedPluginText(field.label, field.localizedLabels, locale);
  const description = localizedPluginText(field.description ?? "", field.localizedDescriptions, locale);
  const shared = { id, disabled, "aria-describedby": description ? `${id}-help` : undefined };
  let input;
  if (field.type === "checkbox") input = <input {...shared} type="checkbox" checked={value === true} onChange={(event) => change(event.target.checked)} />;
  else if (field.type === "text") input = <input {...shared} type="text" value={String(value ?? "")} required={field.required}
    maxLength={field.maxLength} onChange={(event) => change(event.target.value)} />;
  else if (field.type === "number") input = <input {...shared} type="number" value={typeof value === "number" && Number.isFinite(value) ? value : ""}
    min={field.min} max={field.max} step={field.step ?? "any"} required
    onChange={(event) => change(event.target.value === "" ? Number.NaN : Number(event.target.value))} />;
  else if (field.type === "select") input = <select {...shared} value={String(value)} onChange={(event) => change(event.target.value)}>
    {field.options?.map((option) => <option key={option.value} value={option.value}>
      {localizedPluginText(option.label, option.localizedLabels, locale)}
    </option>)}
  </select>;
  else input = <p role="alert">{tr("此设置控件暂不支持，请更新网页客户端。")}</p>;
  return <div className="plugin-setting-field">
    {field.type === "checkbox" ? <label className="check-label">{input}{label}</label> : <><label htmlFor={id}>{label}</label>{input}</>}
    {description && <p id={`${id}-help`} className="muted">{description}</p>}
  </div>;
}
