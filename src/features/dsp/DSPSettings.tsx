import { useId, useState } from "react";
import { ErrorNotice } from "../../components/ui";
import { useServices, useStore } from "../../app/services";
import { tr, useLocale } from "../../i18n";
import { createNode, draftOf, moveNode, pluginFor } from "./model";
import { useDSPSettings } from "./useDSPSettings";
import { DSPNodeEditor } from "./DSPNodeEditor";
import "./dsp.css";

export function DSPSettings() {
  useLocale();
  const services = useServices();
  const auth = useStore(services.auth);
  const [scope, setScope] = useState<"personal" | "global">("personal");
  const [globalVisited, setGlobalVisited] = useState(false);
  const [globalVersion, setGlobalVersion] = useState(0);
  const admin = auth.session?.user.role === "admin";
  return <>
    {admin && <div className="dsp-scope" role="group" aria-label={tr("DSP 配置范围")}>
      <button aria-pressed={scope === "personal"} onClick={() => setScope("personal")}>{tr("我的 DSP")}</button>
      <button aria-pressed={scope === "global"} onClick={() => { setGlobalVisited(true); setScope("global"); }}>{tr("全局默认 DSP")}</button>
    </div>}
    <div hidden={admin && scope !== "personal"}><DSPEditor scope="personal" refreshToken={globalVersion} /></div>
    {admin && globalVisited && <div hidden={scope !== "global"}><DSPEditor scope="global" saved={() => setGlobalVersion((value) => value + 1)} /></div>}
  </>;
}

function DSPEditor({ scope, refreshToken, saved }: { scope: "personal" | "global"; refreshToken?: number; saved?: () => void }) {
  const state = useDSPSettings(scope, refreshToken, saved);
  const bufferHelpId = useId();
  const { data, draft, setDraft } = state;
  const [selected, setSelected] = useState("");
  const preview = state.validation?.result;
  const selectedPlugin = data?.catalog.find((plugin) => plugin.name === selected) ?? data?.catalog[0];
  const locked = state.busy || state.uncertain;
  return <section className="settings-card dsp-settings" aria-label={tr("DSP 配置")}>
    <h3>{tr(scope === "personal" ? "DSP 配置" : "全局默认 DSP")}</h3>
    <p className="muted">{tr(scope === "personal" ? "设置按账号保存在服务端，下一次播放生效，当前歌曲保持原配置。" : "全局配置用于尚未设置个人 DSP 的用户。个人配置可覆盖它；修改在下一次播放生效。")}</p>
    {state.loading && <p role="status">{tr("正在读取设置…")}</p>}
    <ErrorNotice error={state.error} />
    {(!data || state.conflict || state.uncertain) && !state.loading && <div className="dsp-actions">
      {state.uncertain && <button disabled={state.busy} onClick={() => void state.save()}>{tr("重试上次操作")}</button>}
      {!data && <button disabled={state.busy} onClick={() => void state.reloadKeepingDraft()}>{tr("读取最新版本，保留草稿")}</button>}
    </div>}
    {data && draft && <>
      {!data.available && <div className="notice" role="status">
        {tr("服务端 DSP 暂不可用，当前只能查看和编辑草稿。")}
        {data.unavailableReason && <p>{tr(data.unavailableReason)}</p>}
      </div>}
      {data.schemaRevision !== "dsp-settings-v1" && <ErrorNotice error="此配置版本暂不支持，请更新网页客户端。" />}
      <form onSubmit={(event) => { event.preventDefault(); void state.save(); }}>
        {scope === "personal" && <label className="check-label dsp-inherit">
          <input type="checkbox" checked={state.inheritGlobal} disabled={locked} onChange={(event) => {
            state.setInheritGlobal(event.target.checked);
            if (event.target.checked) setDraft(draftOf(data.defaults));
          }} />
          {tr("使用全局配置")}
        </label>}
        {scope === "personal" && <p className="muted">{tr(state.inheritGlobal ? "保存后将跟随全局配置更新。取消勾选可编辑个人配置。" : "个人配置会覆盖全局默认，不受后续全局修改影响。")}</p>}
        <fieldset disabled={locked || state.inheritGlobal}>
          <legend className="sr-only">{tr("DSP 处理配置")}</legend>
          <div className="dsp-output-controls">
            <label>{tr("输出声道")}
              <select aria-label={tr("输出声道")} value={draft.outputLayout} onChange={(event) => setDraft({ ...draft, outputLayout: event.target.value })}>
                {data.outputLayouts.map((layout) => <option key={layout} value={layout}>{layout === "stereo" ? tr("立体声") : layout}</option>)}
              </select>
            </label>
            <label>{tr("DSP Buffer 大小（帧）")}
              <input type="number" min={64} max={16384} step={1} required aria-describedby={bufferHelpId}
                value={Number.isFinite(draft.bufferFrames) ? draft.bufferFrames : ""}
                onChange={(event) => setDraft({ ...draft, bufferFrames: event.target.value === "" ? NaN : Number(event.target.value) })} />
            </label>
          </div>
          <p id={bufferHelpId} className="muted">{tr("每次处理 64–16384 帧，默认 4096 帧。较小值增加调用频率，较大值增加单次处理量；这是 DSP 处理块大小，不是网络缓冲或音频质量。")}</p>
          {Number.isFinite(draft.bufferFrames) && <p className="dsp-buffer-duration">{tr("在 48 kHz 下，每块约 {ms} 毫秒。", { ms: (draft.bufferFrames / 48).toFixed(2) })}</p>}
          <div className="dsp-chain-heading">
            <h4>{tr("效果顺序")}</h4>
            <span className="muted">{tr("{count} / {max} 个效果", { count: draft.chain.length, max: data.maxNodes })}</span>
          </div>
          <p className="muted">{tr("效果从上到下执行，可重复添加。声道转换也可放入链中；输出不支持继续 DSP 的节点必须位于末尾。")}</p>
          <p className="muted">{tr("进入效果链前，音频会先适配所选输出声道；中途转换声道后，链末需回到该布局。")}</p>
          {draft.chain.length === 0 && <p className="dsp-empty">{tr("尚未添加效果，音频仍按所选声道输出。")}</p>}
          <ol className="dsp-chain">
            {draft.chain.map((node, index) => <DSPNodeEditor key={node.key} node={node} index={index} count={draft.chain.length}
              plugin={pluginFor(node.spec.name, data.catalog)} preview={preview?.nodes[index]}
              move={(offset) => setDraft(moveNode(draft, index, offset))}
              remove={() => setDraft({ ...draft, chain: draft.chain.filter((item) => item.key !== node.key) })}
              change={(key, value) => setDraft({ ...draft, chain: draft.chain.map((item) => item.key === node.key ? {
                ...item, spec: { ...item.spec, params: { ...item.spec.params, [key]: value } },
              } : item) })} />)}
          </ol>
          <div className="dsp-add">
            <label>{tr("选择效果")}
              <select aria-label={tr("选择效果")} value={selectedPlugin?.name ?? ""} onChange={(event) => setSelected(event.target.value)}>
                {data.catalog.map((plugin) => <option key={plugin.name} value={plugin.name}>{tr(plugin.displayName)}</option>)}
              </select>
            </label>
            <button type="button" disabled={!selectedPlugin || draft.chain.length >= data.maxNodes} onClick={() => {
              if (selectedPlugin) setDraft({ ...draft, chain: [...draft.chain, createNode(selectedPlugin)] });
            }}>{tr("添加效果")}</button>
          </div>
          {data.available && state.valid && !state.validation && <p role="status">{tr("正在检查处理链…")}</p>}
          <ErrorNotice error={state.validation?.error ?? null} retry={state.retryValidation} />
          {preview && state.valid && <div className="dsp-preview" aria-label={tr("处理链预览")}>
            <p>{tr("处理链预览")}: {preview.input.layout} → {preview.output.format.layout}
              {" · "}{preview.output.canContinueDSP ? tr("可继续 DSP") : tr("不可继续 DSP")}</p>
            <p className="muted">{tr("最终编码输出是播放终点，不可继续 DSP。")}</p>
          </div>}
          {!state.valid && <p role="alert">{tr("请检查声道、Buffer 大小及各效果参数，确保未超过节点数量限制。")}</p>}
        </fieldset>
        <div className="dsp-actions">
          <button className="primary" type="submit" disabled={locked || !data.available || !state.dirty || state.conflict || (!state.inheritGlobal && (!state.valid || !preview))}>{tr("保存设置")}</button>
          <button type="button" disabled={locked} onClick={() => { state.setInheritGlobal(false); setDraft(draftOf(data.defaults)); }}>{tr("恢复默认草稿")}</button>
          <button type="button" disabled={locked} onClick={() => void state.reloadKeepingDraft()}>{tr("读取最新版本，保留草稿")}</button>
        </div>
      </form>
      <p className="muted">{tr("恢复默认仅修改草稿，保存后才生效。")}</p>
      {state.dirty && <p className="muted">{tr("有未保存的修改。")}</p>}
    </>}
    {state.message && <p role="status">{tr(state.message)}</p>}
  </section>;
}
