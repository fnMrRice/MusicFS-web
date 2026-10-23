import { useState } from "react";
import { useServices, useStore } from "../../app/services";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { createLocalDSPNode, defaultLocalDSP, localDSPCatalog, MAX_LOCAL_DSP_NODES, type LocalDSPKind, type LocalDSPNode } from "../../player/dsp/model";
import { LocalDSPNodeEditor } from "./LocalDSPNodeEditor";
import { useDSPDrag } from "./useDSPDrag";
import "./local-dsp-editor.css";

export function LocalDSPSettings() {
  const { localDSP } = useServices();
  const { config, supported, error, storageError, dirty, saved } = useStore(localDSP);
  const [kind, setKind] = useState<LocalDSPKind>("gain");
  const [announcement, setAnnouncement] = useState("");
  const change = (node: LocalDSPNode) => localDSP.update({ ...config, chain: config.chain.map((item) => item.id === node.id ? node : item) });
  function reorder(id: string, to: number) {
    const index = config.chain.findIndex((node) => node.id === id);
    if (index < 0 || index === to) return;
    if (to < 0 || to >= config.chain.length) return;
    const chain = [...config.chain];
    const [node] = chain.splice(index, 1);
    chain.splice(to, 0, node);
    localDSP.update({ ...config, chain });
    setAnnouncement(tr("已移至第 {position} 个效果", { position: to + 1 }));
  }
  const drag = useDSPDrag(reorder);
  const draggingNode = config.chain.find((node) => node.id === drag.drag?.id);
  const draggingName = localDSPCatalog.find((effect) => effect.kind === draggingNode?.kind)?.name;
  return <section className="settings-card dsp-settings local-dsp-settings" aria-label={tr("本地音效")}>
    <h3>{tr("本地音效")}</h3>
    {!supported && <p className="notice" role="status">{tr("此浏览器不支持本地音效。仍可正常播放，音效设置会保留。")}</p>}
    <ErrorNotice error={error} />
    {storageError && <p className="notice" role="status">{tr(storageError)}</p>}
    <div className="local-dsp-toolbar">
      <label className="check-label dsp-toggle">
        <input type="checkbox" checked={config.enabled} disabled={!supported} onChange={(event) => localDSP.update({ ...config, enabled: event.target.checked })} />
        {tr("启用本地音效")}
      </label>
      <div className="local-dsp-save">
        <span className={dirty ? "dsp-unsaved" : "muted"} role="status">{tr(dirty ? "有未保存的更改" : saved ? "已保存" : "调整时实时试听")}</span>
        <button type="button" disabled={!dirty} onClick={() => localDSP.revert()}>{tr("撤销更改")}</button>
        <button type="button" className="primary" disabled={!dirty && !storageError} onClick={() => localDSP.save()}>{tr("保存")}</button>
      </div>
    </div>
    {(!config.enabled || error) && <p className="muted" role="status">{tr(error ? "本地音效暂不可用，请查看上方提示。" : "本地音效已旁路，保留当前效果和参数。")}</p>}
    <div className="dsp-chain-heading">
      <div><h4>{tr("效果顺序")}</h4><p className="muted" id="dsp-drag-help">{tr("拖动手柄调整顺序，也可使用上下方向键。")}</p></div>
      <span className="dsp-count muted">{tr("{count} / {max} 个效果", { count: config.chain.length, max: MAX_LOCAL_DSP_NODES })}</span>
    </div>
    {!config.chain.length && <p className="dsp-empty">{tr("尚未添加本地效果。添加效果即可实时试听。")}</p>}
    <ol ref={drag.list} className={`dsp-chain local-dsp-chain${drag.drag && !drag.drag.beforeId ? " dsp-drop-end" : ""}`}>
      {config.chain.map((node, index) => <LocalDSPNodeEditor key={node.id} node={node} index={index} count={config.chain.length}
        change={change} move={(offset) => reorder(node.id, index + offset)}
        dragging={drag.drag?.id === node.id} dropBefore={drag.drag?.beforeId === node.id}
        dragHandle={{ onPointerDown: (event) => drag.start(event, node.id), onPointerMove: drag.move,
          onPointerUp: drag.end, onPointerCancel: drag.cancel, onLostPointerCapture: drag.cancel,
          onKeyDown: (event) => {
            if (event.key === "Escape") drag.cancel();
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              drag.cancel();
              reorder(node.id, index + (event.key === "ArrowUp" ? -1 : 1));
            }
          } }}
        remove={() => localDSP.update({ ...config, chain: config.chain.filter((item) => item.id !== node.id) })} />)}
    </ol>
    {drag.drag && draggingName && <div className="dsp-drag-preview" aria-hidden="true"
      style={{ left: Math.min(drag.drag.x + 16, window.innerWidth - 180), top: drag.drag.y - 20 }}>{tr(draggingName)}</div>}
    <span className="dsp-sr-only" role="status" aria-live="polite">{announcement}</span>
    <div className="dsp-add">
      <label>{tr("选择效果")}
        <select aria-label={tr("选择效果")} value={kind} onChange={(event) => setKind(event.target.value as LocalDSPKind)}>
          {localDSPCatalog.map((effect) => <option key={effect.kind} value={effect.kind}>{tr(effect.name)}</option>)}
        </select>
      </label>
      <button type="button" disabled={config.chain.length >= MAX_LOCAL_DSP_NODES} onClick={() => localDSP.update({ ...config, chain: [...config.chain, createLocalDSPNode(kind)] })}>{tr("添加效果")}</button>
    </div>
    <button type="button" onClick={() => localDSP.update(defaultLocalDSP())}>{tr("恢复本地默认")}</button>
  </section>;
}
