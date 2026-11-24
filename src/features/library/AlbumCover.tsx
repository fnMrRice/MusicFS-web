import { useState } from "react";
import { catalogArtworkPath } from "../../api/artwork";
import { Icon } from "../../components/ui";
import { tr } from "../../i18n";

export function AlbumCover({ coverPath, name, size = "card", decorative = false }: {
  coverPath?: string | null; name: string; size?: "card" | "heading" | "preview"; decorative?: boolean;
}) {
  const source = catalogArtworkPath(coverPath);
  const [failed, setFailed] = useState<string>();
  return <span className={`album-cover album-cover-${size}`}>
    {source && failed !== source ? <img src={source} alt={decorative ? "" : tr("{0} 的专辑封面", { 0: name })}
      loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(source)} />
      : <Icon name="album" size={size === "card" ? 25 : 34} />}
  </span>;
}
