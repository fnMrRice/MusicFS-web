import { useMemo, useState } from "react";
import type { PackageNode, WorkPackage } from "../../../api/work-packages";
import { useServices, useStore } from "../../../app/services";
import { TrackRowActions } from "../../../components/TrackRowActions";
import { duration, Icon } from "../../../components/ui";
import { tr, useLocale } from "../../../i18n";
import { directoryTracks, fileFormat, fileSize, packageChildren } from "./tree";

export function PackageTree({ value, preview = false, attachment }: {
  value: WorkPackage; preview?: boolean; attachment?: (node: PackageNode) => void;
}) {
  useLocale();
  const services = useServices();
  const current = useStore(services.currentTrack);
  const children = useMemo(() => packageChildren(value.nodes), [value.nodes]);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [message, setMessage] = useState("");
  function render(parentId: string, depth: number) {
    return <ul className="package-tree-level" aria-label={depth === 0 ? tr("副本目录") : undefined}>
      {(children.get(parentId) ?? []).map((node) => {
        const isDirectory = node.kind === "directory";
        const expanded = !collapsed.has(node.nodeId);
        const track = node.track;
        const available = track?.availability === "available";
        const format = fileFormat(node) ?? tr(node.kind === "audio" ? "音频" : "附件");
        const group = isDirectory && !preview ? directoryTracks(children, node.nodeId) : [];
        return <li key={node.nodeId}>
          <div className={`package-node${node.track?.sourceTrackId === current ? " current" : ""}`}>
            {isDirectory ? <button type="button" className="package-directory" aria-expanded={expanded}
              aria-label={tr(expanded ? "收起目录 {0}" : "展开目录 {0}", { 0: node.name })}
              onClick={() => setCollapsed((previous) => {
                const next = new Set(previous); if (expanded) next.add(node.nodeId); else next.delete(node.nodeId); return next;
              })}><Icon name="folder" size={18} /><strong>{node.name}</strong><Icon name="chevron" size={14} /></button> :
              <span className="package-file-name"><Icon name={node.kind === "audio" ? "music" : "lyrics"} size={17} /><span>{node.name}</span></span>}
            {!isDirectory && <small className="muted">{node.kind === "audio" && node.track?.durationMs !== null && node.track?.durationMs !== undefined
              ? `${format} · ${duration(node.track.durationMs)}` : `${format} · ${fileSize(node.sizeBytes)}`}</small>}
            {!preview && isDirectory && <div className="package-node-actions">
              <button type="button" disabled={!group.length} aria-label={tr("播放目录 {0}", { 0: node.name })}
                onClick={() => services.play(group[0], group)}>{tr("播放此目录")}</button>
              <button type="button" disabled={!group.length} aria-label={tr("目录 {0} 加入队列", { 0: node.name })}
                onClick={() => { services.enqueue(group); setMessage(tr("已将 {0} 条音轨加入队列。", { 0: group.length })); }}>{tr("加入队列")}</button>
            </div>}
            {!preview && node.kind === "audio" && <div className="package-node-actions">
              {!available && <span className="muted">{tr("音轨暂不可用")}</span>}
              <TrackRowActions title={node.name} playLabel={tr("播放音轨 {0}", { 0: node.name })}
                play={track ? () => services.play(track) : null}
                enqueue={track ? () => { services.enqueue([track]); setMessage(tr("已将音轨加入队列。")); } : null}
                playbackDisabled={!available} />
            </div>}
            {!preview && node.kind === "attachment" && <button type="button" aria-label={tr("查看附件 {0}", { 0: node.name })}
              onClick={() => attachment?.(node)}>{tr(node.attachmentKind === "download" ? "下载附件" : "查看附件")}</button>}
          </div>
          {isDirectory && expanded && render(node.nodeId, depth + 1)}
        </li>;
      })}
    </ul>;
  }
  return <>{message && <p role="status" className="muted">{message}</p>}{render("", 0)}</>;
}
