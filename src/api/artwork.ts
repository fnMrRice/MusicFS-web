// 服务端文件路径不能交给浏览器；在线来源只可引用同源的曲目封面端点。
export function onlineArtworkPath(value: unknown): string | undefined {
  return typeof value === "string" && /^\/api\/v1\/source-tracks\/[A-Za-z0-9_-]+\/online-artwork$/.test(value) ? value : undefined;
}

export function mediaObject(path: string | null | undefined): string | undefined {
  return typeof path === "string" ? path.match(/^\/api\/v1\/media\/([A-Za-z0-9_-]+)$/)?.[1] : undefined;
}

export function catalogArtworkPath(path: string | null | undefined): string | undefined {
  if (typeof path !== "string" || !path) return;
  if (mediaObject(path) || onlineArtworkPath(path)) return path;
  try {
    const url = new URL(path);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch { /* 本地文件及其它不支持的引用保留为资料。 */ }
}
