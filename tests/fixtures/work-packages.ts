import type { PackageNode, PackagePreview, WorkPackage } from "../../src/api/work-packages";
import { track } from "./dto";

export const packagePNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2WPcAAAAASUVORK5CYII=", "base64");
export const packageText = "作品说明\n<script>window.attachmentExecuted=true</script>\n雨夜社";
const node = (path: string, kind: PackageNode["kind"], extra: Partial<PackageNode> = {}): PackageNode => ({
  nodeId: path, parentId: path === "." ? "" : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".",
  path, name: path === "." ? "RJ123456 雨夜" : path.split("/").at(-1)!, kind, order: 0, mime: "", sizeBytes: 0,
  sourceTrackId: "", assetId: "", attachmentKind: "", track: null, ...extra,
});
const audio = (path: string, available = true) => node(path, "audio", {
  mime: "audio/wav", sizeBytes: 1000, sourceTrackId: `track-${path}`, assetId: `asset-${path}`,
  track: available ? { ...track, sourceTrackId: `track-${path}`, displayName: path.split("/").at(-1)!, assetId: `asset-${path}`,
    codec: path.endsWith(".mp3") ? "mp3" : "pcm_s16le", container: path.endsWith(".mp3") ? "mp3" : "wav" } : null,
});
export function packageFixture(revision = 1): WorkPackage {
  return {
    packageId: "package-one", workId: "one", providerInstanceId: "local", rootId: "root", relativePath: "RJ123456 雨夜",
    name: "RJ123456 雨夜", revision, importedAt: "2026-10-22T00:00:00Z",
    nodes: [node(".", "directory"), node("WAV", "directory"), audio("WAV/01.wav"), node("WAV/特典", "directory"),
      audio("WAV/特典/02.wav"), node("MP3", "directory"), audio("MP3/01.mp3"), audio("MP3/失效.mp3", false),
      node("说明.txt", "attachment", { attachmentKind: "text", mime: "text/plain", sizeBytes: 100 }),
      node("封面.png", "attachment", { attachmentKind: "image", mime: "image/png", sizeBytes: packagePNG.length }),
      node("原始文档.pdf", "attachment", { attachmentKind: "download", mime: "application/pdf", sizeBytes: 100 }),
      node("大文本.txt", "attachment", { attachmentKind: "text", mime: "text/plain", sizeBytes: 1024 * 1024 + 1 }),
    ].map((value, order) => ({ ...value, order })),
  };
}
export function previewFixture(index = 1): PackagePreview {
  const value = packageFixture();
  return { previewId: `preview-${index}`, workId: "one", expiresAt: "2099-01-01T00:00:00Z",
    package: { ...value, packageId: "", revision: 0, nodes: value.nodes.map((item) => ({ ...item, sourceTrackId: "", assetId: "", track: null })) },
    counts: { directories: 4, audio: 4, attachments: 4 }, warnings: ["请在确认前核对版本目录。"] };
}
