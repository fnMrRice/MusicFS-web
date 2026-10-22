import { useId, useState } from "react";
import { tr } from "../../i18n";
import { localDSPCatalog, type LocalDSPNode, type LocalDSPParameter } from "../../player/dsp/model";

interface Props {
  node: LocalDSPNode;
  index: number;
  count: number;
  change(node: LocalDSPNode): void;
  move(offset: number): void;
  remove(): void;
}

export function LocalDSPNodeEditor({ node, index, count, change, move, remove }: Props) {
  const effect = localDSPCatalog.find((item) => item.kind === node.kind)!;
  const name = tr(effect.name);
  return <li className="dsp-node" aria-label={tr("第 {position} 个效果：{name}", { position: index + 1, name })}>
    <div className="dsp-node-heading">
      <h4><span className="dsp-position">{index + 1}</span>{name}</h4>
      <div className="dsp-node-actions">
        <button type="button" aria-label={tr("上移 {name}", { name })} disabled={index === 0} onClick={() => move(-1)}>{tr("上移")}</button>
        <button type="button" aria-label={tr("下移 {name}", { name })} disabled={index === count - 1} onClick={() => move(1)}>{tr("下移")}</button>
        <button type="button" aria-label={tr("删除 {name}", { name })} onClick={remove}>{tr("删除")}</button>
      </div>
    </div>
    <p className="muted">{tr(effect.description)}</p>
    <label className="check-label dsp-toggle">
      <input type="checkbox" checked={node.enabled} onChange={(event) => change({ ...node, enabled: event.target.checked })} />
      {tr("启用 {name}", { name })}
    </label>
    <div className="dsp-parameters">
      {effect.params.map((parameter) => <Parameter key={parameter.key} parameter={parameter} value={node.params[parameter.key]}
        change={(value) => change({ ...node, params: { ...node.params, [parameter.key]: value } })} />)}
    </div>
  </li>;
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
