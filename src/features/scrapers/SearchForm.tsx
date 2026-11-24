import type { Scraper, ScraperQuery } from "../../api/scrapers";
import { type ReactNode, useId } from "react";
import { languageLabel, type LocalizedTitle } from "../../api/localized-titles";
import { tr, useLocale } from "../../i18n";
import { scrapedFieldName } from "./fields";

export function SearchForm({ sources, source, field, query, disabled, searching, changeSource, changeField, changeQuery, submit,
  titleOptions, children, fields, localOnly, automatic, hasTrack }: {
  sources: Scraper[]; source: Scraper; field: string; query: ScraperQuery; disabled: boolean; searching: boolean;
  changeSource: (id: string) => void; changeField: (field: string) => void; changeQuery: (value: ScraperQuery) => void; submit: () => void;
  titleOptions?: LocalizedTitle[]; children?: ReactNode;
  fields: string[]; localOnly: boolean; automatic: boolean; hasTrack: boolean;
}) {
  const listId = useId();
  const { locale } = useLocale();
  const input = (name: Exclude<keyof ScraperQuery, "duration">, label: string, maxLength = 255) =>
    <label>{tr(label)}<input value={query[name] ?? ""} maxLength={maxLength} list={name === "title" && titleOptions?.length ? listId : undefined}
      onChange={(e) => changeQuery({ ...query, [name]: e.target.value })} /></label>;
  const duration = <label>{tr("时长（秒）")}<input type="number" step="any" min="0.001" max={86400}
    value={query.duration ?? ""} onChange={(e) => changeQuery({ ...query, duration: e.target.value ? Number(e.target.value) : undefined })} /></label>;
  const fingerprint = field === "recordingIdentity";
  const valid = automatic ? hasTrack || !!query.title?.trim() : localOnly ? hasTrack : source.requiresExternalId ? !!query.externalId?.trim() :
    fingerprint ? !!query.fingerprint?.trim() && !!query.duration : [query.title, query.artist, query.album, query.externalId].some(value => value?.trim());
  return <form onSubmit={(event) => { event.preventDefault(); if (source.available && valid && !disabled) submit(); }}>
    <fieldset className="scraper-controls" disabled={disabled}>
      <div className="scraper-selectors">
        <label>{tr("资料来源")}<select value={source.pluginId} onChange={(event) => changeSource(event.target.value)}>
          {sources.map((item) => <option key={item.pluginId} value={item.pluginId}>{item.name}{item.available ? "" : ` · ${tr("不可用")}`}</option>)}
        </select></label>
        <label>{tr("刮削内容")}<select value={field} onChange={(event) => changeField(event.target.value)}>
          {fields.map((option) => <option key={option} value={option}>{scrapedFieldName(option)}</option>)}
        </select></label>
      </div>
      {children}
      {!!titleOptions?.length && <datalist id={listId}>{titleOptions.map(({ language, title }) =>
        <option key={language + ":" + title} value={title}>{languageLabel(language, locale)}</option>)}</datalist>}
      {localOnly ? null : source.requiresExternalId ? input("externalId", "来源编号") : fingerprint ? <div className="scraper-inputs">{input("fingerprint", "音频指纹", 49152)}{duration}</div> : <>
        <div className="scraper-inputs">
          {input("title", "标题或关键词")}
          {input("artist", "歌手名称")}
          {!automatic && input("externalId", "来源编号")}
        </div>
        <details><summary>{tr("更多查询条件")}</summary>
          <div className="scraper-inputs">
            {input("album", "专辑名称")}{duration}{!automatic && input("country", "查询地区", 2)}
          </div>
        </details>
      </>}
      {!source.available && <p role="status">{tr("此来源当前不可用，请检查服务端配置。")}</p>}
    </fieldset>
    <button className="primary" type="submit" disabled={disabled || !valid || !source.available}>
      {tr(searching ? "正在查询资料…" : "搜索")}
    </button>
  </form>;
}
