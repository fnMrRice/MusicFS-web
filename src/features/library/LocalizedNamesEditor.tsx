import { useId } from "react";
import { type LocalizedTitle, languageLabel, validLocalizedNames } from "../../api/localized-titles";
import { IconButton } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import "./localized-names.css";

export { languageLabel, validLocalizedNames };

export function LocalizedNamesEditor({ names, onChange, disabled = false, titleLabel }: {
  names: LocalizedTitle[];
  onChange: (names: LocalizedTitle[]) => void;
  disabled?: boolean;
  titleLabel?: string;
}) {
  const { locale } = useLocale();
  const listId = useId();
  const update = (index: number, patch: Partial<LocalizedTitle>) =>
    onChange(names.map((entry, position) => position === index ? { ...entry, ...patch } : entry));
  return <fieldset className="localized-names-editor" disabled={disabled}>
    <datalist id={listId}>{["und", "zh-Hans", "zh-Hant", "ja", "ja-Latn", "en", "ko"].map(tag =>
      <option key={tag} value={tag}>{languageLabel(tag, locale)}</option>)}</datalist>
    {names.map((entry, index) => <div className="localized-name-row" key={index}>
      <label>{tr("语言标签")}<input value={entry.language} list={listId} placeholder="ja-Latn" required maxLength={63}
        onChange={event => update(index, { language: event.target.value })} /></label>
      <label>{titleLabel ?? tr("名称")}<input value={entry.title} required
        onChange={event => update(index, { title: event.target.value })} /></label>
      <IconButton icon="close" label={tr("移除名称 {0}", { 0: entry.title || index + 1 })}
        onClick={() => onChange(names.filter((_, position) => position !== index))} />
    </div>)}
    <button type="button" disabled={names.length >= 64}
      onClick={() => onChange([...names, { language: "und", title: "" }])}>{tr("添加名称")}</button>
  </fieldset>;
}
