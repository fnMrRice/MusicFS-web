import { useId } from "react";
import type { DSPFormat, DSPPlugin, DSPValidation } from "../../api/dsp";
import { tr } from "../../i18n";
import type { DraftNode } from "./model";

function formatDescription(format: DSPFormat) {
  return `${format.layout} / ${format.sampleRate / 1000} kHz / ${format.sampleFormat}`;
}

export function DSPNodeEditor({ node, plugin, index, count, preview, change, move, remove }: {
  node: DraftNode; plugin?: DSPPlugin; index: number; count: number;
  preview?: DSPValidation["nodes"][number]; change: (key: string, value: number) => void;
  move: (offset: number) => void; remove: () => void;
}) {
  const id = useId();
  const name = plugin ? tr(plugin.displayName) : node.spec.name;
  return <li className="dsp-node" aria-label={tr("第 {position} 个效果：{name}", { position: index + 1, name })}>
    <div className="dsp-node-heading">
      <h4><span className="dsp-position">{index + 1}</span>{name}</h4>
      <div className="dsp-node-actions">
        <button type="button" disabled={index === 0} onClick={() => move(-1)} aria-label={tr("上移 {name}", { name })}>{tr("上移")}</button>
        <button type="button" disabled={index === count - 1} onClick={() => move(1)} aria-label={tr("下移 {name}", { name })}>{tr("下移")}</button>
        <button type="button" onClick={remove} aria-label={tr("删除 {name}", { name })}>{tr("删除")}</button>
      </div>
    </div>
    {plugin && <p className="muted">{tr(plugin.description)}</p>}
    <p className="dsp-node-io">
      {tr("输入")}: {preview ? formatDescription(preview.input) : plugin ? `${plugin.input.layouts.join(" / ")} · ${plugin.input.sampleRate / 1000} kHz · ${plugin.input.sampleFormat}` : "—"}
      {" → "}{tr("输出")}: {preview ? formatDescription(preview.output.format) : plugin?.output.sameAsInput ? tr("与输入相同") : plugin?.output.layouts.join(" / ") ?? "—"}
      {" · "}{(preview?.output.canContinueDSP ?? plugin?.output.canContinueDSP) ? tr("可继续 DSP") : tr("不可继续 DSP")}
    </p>
    {!plugin && <p role="alert">{tr("此效果当前不可用，请移除或联系管理员。")}</p>}
    <div className="dsp-parameters">
      {plugin?.parameters.map((parameter) => {
        const fieldId = `${id}-${parameter.key}`;
        const value = node.spec.params?.[parameter.key] ?? parameter.defaultValue;
        return <label key={parameter.key} htmlFor={fieldId}>
          <span>{tr(parameter.label)}</span>
          {parameter.options ? <select id={fieldId} value={value} onChange={(event) => change(parameter.key, Number(event.target.value))}>
            {parameter.options.map((option) => <option key={option.value} value={option.value}>{tr(option.label)}</option>)}
          </select> : <input id={fieldId} type="number" value={Number.isFinite(value) ? value : ""} required
            min={parameter.min} max={parameter.max} step={parameter.step || "any"}
            onChange={(event) => change(parameter.key, event.target.value === "" ? NaN : Number(event.target.value))} />}
        </label>;
      })}
    </div>
  </li>;
}
