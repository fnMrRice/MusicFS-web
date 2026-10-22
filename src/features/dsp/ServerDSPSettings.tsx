import { useState } from "react";
import { ErrorNotice } from "../../components/ui";
import { useServices, useStore } from "../../app/services";
import { tr } from "../../i18n";
import { draftOf } from "./model";
import { useDSPSettings } from "./useDSPSettings";

export function ServerDSPSettings() {
  const services = useServices();
  const auth = useStore(services.auth);
  const [scope, setScope] = useState<"personal" | "global">("personal");
  const [globalVisited, setGlobalVisited] = useState(false);
  const [globalVersion, setGlobalVersion] = useState(0);
  const admin = auth.session?.user.role === "admin";
  return <>
    {admin && <div className="dsp-scope" role="group" aria-label={tr("格式转换配置范围")}>
      <button aria-pressed={scope === "personal"} onClick={() => setScope("personal")}>{tr("我的格式转换")}</button>
      <button aria-pressed={scope === "global"} onClick={() => { setGlobalVisited(true); setScope("global"); }}>{tr("全局格式转换")}</button>
    </div>}
    <div hidden={admin && scope !== "personal"}><FormatEditor scope="personal" refreshToken={globalVersion} /></div>
    {admin && globalVisited && <div hidden={scope !== "global"}><FormatEditor scope="global" saved={() => setGlobalVersion((value) => value + 1)} /></div>}
  </>;
}

function FormatEditor({ scope, refreshToken, saved }: { scope: "personal" | "global"; refreshToken?: number; saved?: () => void }) {
  const state = useDSPSettings(scope, refreshToken, saved);
  const { data, draft, setDraft } = state;
  const locked = state.busy || state.uncertain;
  return <section className="settings-card dsp-settings server-dsp-settings" aria-label={tr("服务端格式转换")}>
    <h3>{tr(scope === "personal" ? "服务端格式转换" : "全局格式转换")}</h3>
    <p className="muted">{tr("服务端保留格式转换、转码和必要的声道转换。Web 音效在本地处理，此处不应用增益、均衡器、压缩或混响。")}</p>
    <p className="muted">{tr("声道配置保存在服务端，下次播放时生效。未设置个人配置时使用全局默认。")}</p>
    {state.loading && <p role="status">{tr("正在读取设置…")}</p>}
    <ErrorNotice error={state.error} />
    {(!data || state.conflict || state.uncertain) && !state.loading && <div className="dsp-actions">
      {state.uncertain && <button disabled={state.busy} onClick={() => void state.save()}>{tr("重试上次操作")}</button>}
      {!data && <button disabled={state.busy} onClick={() => void state.reloadKeepingDraft()}>{tr("读取最新版本，保留草稿")}</button>}
    </div>}
    {data && draft && <>
      {!data.available && <div className="notice" role="status">
        {tr("服务端格式转换暂不可用，当前只能查看和编辑草稿。")}
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
        <fieldset disabled={locked || state.inheritGlobal}>
          <legend className="sr-only">{tr("声道转换")}</legend>
          <div className="dsp-output-controls">
            <label>{tr("输出声道")}
              <select aria-label={tr("输出声道")} value={draft.outputLayout} onChange={(event) => setDraft({ ...draft, outputLayout: event.target.value })}>
                {data.outputLayouts.map((layout) => <option key={layout} value={layout}>{layout === "stereo" ? tr("立体声") : layout === "mono" ? tr("单声道") : layout}</option>)}
              </select>
            </label>
          </div>
          <ErrorNotice error={state.validation?.error ?? null} retry={state.retryValidation} />
        </fieldset>
        <div className="dsp-actions">
          <button className="primary" type="submit" disabled={locked || !data.available || !state.dirty || state.conflict || (!state.inheritGlobal && (!state.valid || !state.validation?.result))}>{tr("保存设置")}</button>
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
