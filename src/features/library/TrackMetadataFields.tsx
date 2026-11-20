import { useId, type ReactNode } from "react";
import { tr, useLocale } from "../../i18n";
import { LocalizedNamesEditor } from "./LocalizedNamesEditor";
import { trackMetadataErrors, trackMetadataLabels, type TrackMetadataDraft } from "./track-metadata-draft";
import "./track-metadata.css";

export function TrackMetadataFields({ draft, onChange, disabled, fieldControl }: {
  draft: TrackMetadataDraft;
  onChange: (draft: TrackMetadataDraft) => void;
  disabled?: boolean;
  fieldControl?: (field: keyof TrackMetadataDraft) => ReactNode;
}) {
  useLocale();
  const id = useId();
  const errors = trackMetadataErrors(draft);
  function field(key: keyof TrackMetadataDraft, input: ReactNode) {
    const label = tr(trackMetadataLabels[key]);
    return <div className={`track-meta-field track-meta-${key}`}>
      <div className="track-meta-heading">
        {key === "localizedTitles" ? <span id={`${id}-aliases`}>{label}</span> : <label htmlFor={`${id}-${key}`}>{label}</label>}
        {fieldControl?.(key)}
      </div>
      {input}
      {errors[key] && <small className="track-meta-error" id={`${id}-${key}-error`}>{tr(errors[key]!)}</small>}
    </div>;
  }
  function attributes(key: Exclude<keyof TrackMetadataDraft, "localizedTitles">) {
    return {
      id: `${id}-${key}`, value: draft[key],
      "aria-invalid": !!errors[key],
      "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        onChange({ ...draft, [key]: event.target.value }),
    };
  }
  return <fieldset className="track-meta-fields" disabled={disabled}>
    {field("title", <input required {...attributes("title")} />)}
    {field("artistNames", <textarea rows={2} {...attributes("artistNames")} aria-describedby={errors.artistNames ? `${id}-artistNames-error` : `${id}-artist-hint`} />)}
    <small className="track-meta-artist-hint muted" id={`${id}-artist-hint`}>{tr("每行填写一位歌手。")}</small>
    {field("genre", <input {...attributes("genre")} />)}
    {field("year", <input inputMode="numeric" {...attributes("year")} />)}
    {field("rating", <select {...attributes("rating")}>
      <option value="">{tr("未评分")}</option>
      {[1, 2, 3, 4, 5].map(rating => <option value={rating} key={rating}>{rating}</option>)}
    </select>)}
    {field("coverPath", <input {...attributes("coverPath")} />)}
    {field("localizedTitles", <div role="group" aria-labelledby={`${id}-aliases`}>
      <LocalizedNamesEditor names={draft.localizedTitles} disabled={disabled} titleLabel={tr("别名")}
        onChange={localizedTitles => onChange({ ...draft, localizedTitles })} />
    </div>)}
  </fieldset>;
}
