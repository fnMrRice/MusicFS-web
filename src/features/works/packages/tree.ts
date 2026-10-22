import type { PackageNode } from "../../../api/work-packages";
import type { SourceTrack } from "../../../api/types";

export function packageChildren(nodes: PackageNode[]): Map<string, PackageNode[]> {
  const children = new Map<string, PackageNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node); children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.order - right.order);
  return children;
}

// 只按所选目录的层级与服务端顺序取音轨，不把其他版本目录并入队列。
export function directoryTracks(children: Map<string, PackageNode[]>, directoryId: string): SourceTrack[] {
  const pending = [...(children.get(directoryId) ?? [])].reverse();
  const result: SourceTrack[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === "directory") pending.push(...[...(children.get(node.nodeId) ?? [])].reverse());
    else if (node.kind === "audio" && node.track?.availability === "available") result.push(node.track);
  }
  return result;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const formatNames: Record<string, string> = {
  wav: "WAV", wave: "WAV", mp3: "MP3", flac: "FLAC", aac: "AAC", m4a: "M4A", mp4: "MP4",
  ogg: "OGG", opus: "Opus", aiff: "AIFF", aif: "AIFF", png: "PNG", jpg: "JPEG", jpeg: "JPEG",
  gif: "GIF", webp: "WebP", txt: "TXT", pdf: "PDF", zip: "ZIP",
};
const mimeFormats: Record<string, string> = {
  "audio/wav": "WAV", "audio/x-wav": "WAV", "audio/mpeg": "MP3", "audio/flac": "FLAC",
  "audio/x-flac": "FLAC", "audio/aac": "AAC", "audio/mp4": "M4A", "audio/ogg": "OGG",
  "audio/opus": "Opus", "audio/aiff": "AIFF", "image/png": "PNG", "image/jpeg": "JPEG",
  "image/gif": "GIF", "image/webp": "WebP", "text/plain": "TXT", "application/pdf": "PDF", "application/zip": "ZIP",
};
const formatName = (names: Record<string, string>, value: string) => Object.hasOwn(names, value) ? names[value] : null;

// 目录仅显示常见文件格式；未知值交给页面显示音频或附件，不暴露底层编码标识。
export function fileFormat(node: PackageNode): string | null {
  return formatName(formatNames, node.track?.container?.toLowerCase() ?? "") ??
    formatName(mimeFormats, node.mime.split(";")[0].trim().toLowerCase()) ??
    formatName(formatNames, node.name.split(".").at(-1)?.toLowerCase() ?? "");
}
