import type { LocalizedTitle } from "../../api/localized-titles";
import "./localized-names.css";

export function OtherTrackTitles({ title, names }: { title: string; names?: LocalizedTitle[] }) {
  const others = [...new Set(names?.map(name => name.title))].filter(name => name.toLowerCase() !== title.toLowerCase());
  if (!others.length) return null;
  return <small className="track-other-titles" title={others.join(" · ")}>{others[0]}{others.length > 1 ? " …" : ""}</small>;
}
