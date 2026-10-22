import { useId, useState, type ButtonHTMLAttributes } from "react";
import { Icon } from "../../components/ui";
import { tr } from "../../i18n";
import { localDSPCatalog, type LocalDSPNode, type LocalDSPParameter } from "../../player/dsp/model";
import { GraphicEqualizerEditor } from "./GraphicEqualizerEditor";

interface Props {
  node: LocalDSPNode;
  index: number;
  count: number;
  dragging: boolean;
  dropBefore: boolean;
  dragHandle: ButtonHTMLAttributes<HTMLButtonElement>;
  change(node: LocalDSPNode): void;
  move(offset: number): void;
  remove(): void;
}

export function LocalDSPNodeEditor({ node, index, count, change, move, remove, dragging, dropBefore, dragHandle }: Props) {
  const effect = localDSPCatalog.find((item) => item.kind === node.kind)!;
  const name = tr(effect.name);
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  return <li data-effect-id={node.id} className={`dsp-node local-dsp-node${dragging ? " is-dragging" : ""}${dropBefore ? " drop-before" : ""}${!node.enabled ? " is-bypassed" : ""}`}
    aria-label={tr("第 {position} 个效果：{name}", { position: index + 1, name })}>
    <div className="dsp-node-heading">
      <div className="local-dsp-node-title">
        <button type="button" className="dsp-drag-handle" aria-label={tr("拖动 {name}", { name })} aria-describedby="dsp-drag-help" {...dragHandle}>
          <svg width="18" height="22" viewBox="0 0 18 22" fill="currentColor" aria-hidden="true">
            {[5, 11, 17].map((y) => <g key={y}><circle cx="6" cy={y} r="1.5" /><circle cx="12" cy={y} r="1.5" /></g>)}
          </svg>
        </button>
        <span className="dsp-position">{index + 1}</span>
        <h4><button type="button" className="dsp-collapse" aria-expanded={expanded} aria-controls={bodyId}
          aria-label={tr(expanded ? "收起 {name}" : "展开 {name}", { name })} onClick={() => setExpanded(!expanded)}>
          <span className="dsp-effect-name">{name}</span>
          {!expanded && <span className="dsp-node-summary muted">{summary(node)}</span>}
          <Icon name="chevron" size={16} />
        </button></h4>
      </div>
      <div className="dsp-node-actions">
        <label className="check-label dsp-toggle dsp-node-toggle">
          <input type="checkbox" checked={node.enabled} aria-label={tr("启用 {name}", { name })} onChange={(event) => change({ ...node, enabled: event.target.checked })} />
          <span>{tr(node.enabled ? "开启" : "关闭")}</span>
        </label>
        <button type="button" className="dsp-move" aria-label={tr("上移 {name}", { name })} disabled={index === 0} onClick={() => move(-1)}><span aria-hidden="true">↑</span></button>
        <button type="button" className="dsp-move" aria-label={tr("下移 {name}", { name })} disabled={index === count - 1} onClick={() => move(1)}><span aria-hidden="true">↓</span></button>
        <button type="button" className="dsp-remove" aria-label={tr("删除 {name}", { name })} onClick={remove}><Icon name="close" size={16} /></button>
      </div>
    </div>
    <div className="dsp-node-body" id={bodyId} hidden={!expanded}>
      {node.kind === "graphicEqualizer" ? <GraphicEqualizerEditor node={node} change={change} /> : <>
        <p className="muted dsp-effect-description">{tr(effect.description)}</p>
        <div className="dsp-parameters">
          {effect.params.map((parameter) => <Parameter key={parameter.key} parameter={parameter} value={node.params[parameter.key]}
            change={(value) => change({ ...node, params: { ...node.params, [parameter.key]: value } })} />)}
        </div>
      </>}
    </div>
  </li>;
}

function summary(node: LocalDSPNode): string {
  const p = node.params;
  const db = (value: number) => `${value > 0 ? "+" : ""}${value} dB`;
  if (node.kind === "gain") return db(p.gain);
  if (node.kind === "equalizer") return `${p.frequency} Hz · ${db(p.gain)} · Q ${p.q}`;
  if (node.kind === "compressor") return `${tr("阈值")} ${db(p.threshold)} · ${p.ratio}:1`;
  if (node.kind === "graphicEqualizer") {
    const values = Object.entries(p).filter(([key]) => key.startsWith("band")).map(([, value]) => value);
    return `${tr("10 段均衡器")} · ${db(Math.min(...values))} ~ ${db(Math.max(...values))}`;
  }
  return `${tr("混响比例")} ${Math.round(p.mix * 100)}% · ${p.decay} s`;
}

function Parameter({ parameter, value, change }: { parameter: LocalDSPParameter; value: number; change(value: number): void }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const label = parameter.unit ? tr("{name}（{unit}）", { name: tr(parameter.label), unit: parameter.unit }) : tr(parameter.label);
  return <div className="local-dsp-parameter">
    <label htmlFor={id}>{label}</label>
    <div className="local-dsp-parameter-inputs">
      <input type="range" aria-label={tr("调节 {name}", { name: label })} min={parameter.min} max={parameter.max} step={parameter.step} value={value}
        onChange={(event) => { setDraft(null); change(Number(event.target.value)); }} />
      <input id={id} type="number" min={parameter.min} max={parameter.max} step={parameter.step} value={draft ?? value}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const parsed = Number(text);
          if (text.trim() && Number.isFinite(parsed) && parsed >= parameter.min && parsed <= parameter.max) change(parsed);
        }}
        onBlur={() => {
          if (draft !== null && draft.trim() && Number.isFinite(Number(draft))) change(Math.max(parameter.min, Math.min(parameter.max, Number(draft))));
          setDraft(null);
        }} />
    </div>
  </div>;
}
