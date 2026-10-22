import type { ContentType } from "../../api/works";
import { tr } from "../../i18n";

// 侧栏使用简短名称；作品资料及编辑器保留插件声明的完整名称。
export function workCategoryName(type: Pick<ContentType, "id" | "name">): string {
  if (type.id === "music") return tr("专辑");
  if (type.id === "asmr") return "ASMR";
  return type.name;
}

export function workSectionTitle(pathname: string, search: string): string | undefined {
  if (pathname === "/library") return "曲目列表";
  if (pathname.startsWith("/works/")) return "作品详情";
  if (pathname !== "/works") return undefined;
  const params = new URLSearchParams(search);
  if (params.get("packageKind") === "cd_dump") return "CD 抓轨";
  if (params.get("contentType") === "music") return "专辑";
  if (params.get("contentType") === "asmr") return "ASMR";
  return "作品库";
}
