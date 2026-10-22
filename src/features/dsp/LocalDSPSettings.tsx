import { useState } from "react";
import { useServices, useStore } from "../../app/services";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { createLocalDSPNode, defaultLocalDSP, localDSPCatalog, MAX_LOCAL_DSP_NODES, type LocalDSPKind, type LocalDSPNode } from "../../player/dsp/model";
import { LocalDSPNodeEditor } from "./LocalDSPNodeEditor";

export function LocalDSPSettings() {
  const { localDSP } = useServices();
  const { config, supported, error, storageError } = useStore(localDSP);
  const [kind, setKind] = useState<LocalDSPKind>("gain");
  const change = (node: LocalDSPNode) => localDSP.update({ ...config, chain: config.chain.map((item) => item.id === node.id ? node : item) });
  function move(index: number, offset: number) {
    const to = index + offset;
    if (to < 0 || to >= config.chain.length) return;
    const chain = [...config.chain];
    [chain[index], chain[to]] = [chain[to], chain[index]];
    localDSP.update({ ...config, chain });
  }
  return <section className="settings-card dsp-settings local-dsp-settings" aria-label={tr("本地音效")}>
    <h3>{tr("本地音效")}</h3>
    <p className="muted">{tr("音效在此浏览器处理，调整立即生效，无需重新播放。设置仅保存在本浏览器，按实例和账号区分。")}</p>
    <p className="muted">{tr("服务端负责格式转换、转码及必要的声道转换；Web 播放不会重复应用服务端音效。")}</p>
    {!supported && <p className="notice" role="status">{tr("此浏览器不支持本地音效。仍可正常播放，音效设置会保留。")}</p>}
    <ErrorNotice error={error} />
    {storageError && <p className="notice" role="status">{tr(storageError)}</p>}
    <label className="check-label dsp-toggle">
      <input type="checkbox" checked={config.enabled} disabled={!supported} onChange={(event) => localDSP.update({ ...config, enabled: event.target.checked })} />
      {tr("启用本地音效")}
    </label>
    <p className="muted" role="status">{tr(error ? "本地音效暂不可用，请查看上方提示。" : config.enabled && supported ? "本地音效已开启，参数实时生效。" : "本地音效已旁路，保留当前效果和参数。")}</p>
    <div className="dsp-chain-heading">
      <h4>{tr("效果顺序")}</h4>
      <span className="muted">{tr("{count} / {max} 个效果", { count: config.chain.length, max: MAX_LOCAL_DSP_NODES })}</span>
    </div>
    <p className="muted">{tr("效果从上到下处理，可重复添加，也可单独关闭。增强频段或增益时可适当降低总音量，避免失真。")}</p>
    {!config.chain.length && <p className="dsp-empty">{tr("尚未添加本地效果。添加效果即可实时试听。")}</p>}
    <ol className="dsp-chain">
      {config.chain.map((node, index) => <LocalDSPNodeEditor key={node.id} node={node} index={index} count={config.chain.length}
        change={change} move={(offset) => move(index, offset)}
        remove={() => localDSP.update({ ...config, chain: config.chain.filter((item) => item.id !== node.id) })} />)}
    </ol>
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
