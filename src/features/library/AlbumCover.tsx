import { useState } from "react";
import { coverObject } from "../../api/music-catalog";
import { useServices } from "../../app/services";
import { Icon } from "../../components/ui";
import { tr } from "../../i18n";
import { externalLink } from "../scrapers/fields";

export function AlbumCover({ coverPath, name, size = "card", decorative = false }: {
  coverPath?: string | null; name: string; size?: "card" | "heading" | "preview"; decorative?: boolean;
}) {
  const client = useServices().client;
  const objectId = coverObject(coverPath ?? null);
  // 仅允许受鉴权媒体引用与安全的线上图片，服务器文件路径不交给浏览器加载。
  const source = objectId ? client.url(`/media/${encodeURIComponent(objectId)}`) : externalLink(coverPath ?? undefined);
  const [failed, setFailed] = useState<string>();
  return <span className={`album-cover album-cover-${size}`}>
    {source && failed !== source ? <img src={source} alt={decorative ? "" : tr("{0} 的专辑封面", { 0: name })}
      loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(source)} />
      : <Icon name="album" size={size === "card" ? 25 : 34} />}
  </span>;
}
