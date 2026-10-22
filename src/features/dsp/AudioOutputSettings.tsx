import { useEffect } from "react";
import { useServices, useStore } from "../../app/services";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import type { AudioOutputConfig } from "../../player/dsp/output";
import "./audio-output.css";

const layouts: readonly { value: AudioOutputConfig["layout"]; name: string; channels: number }[] = [
  { value: "source", name: "跟随音源", channels: 0 },
  { value: "mono", name: "单声道", channels: 1 },
  { value: "stereo", name: "立体声", channels: 2 },
  { value: "5.1", name: "5.1", channels: 6 },
  { value: "7.1", name: "7.1", channels: 8 },
];

export function AudioOutputSettings() {
  const services = useServices();
  const { audioOutput } = services;
  const { config, status, storageError, dirty, saved } = useStore(audioOutput);
  const { error } = useStore(services.localDSP);
  useEffect(() => { services.inspectAudioOutput(); }, [services]);
  const channels = (count: number | null) => count === null ? tr("播放后显示") : tr("{count} 声道", { count });
  return <section className="settings-card dsp-settings audio-output-settings" aria-label={tr("输出设置")}>
    {!status.supported && <p className="notice" role="status">{tr("此浏览器不支持输出调整，将使用默认播放输出。")}</p>}
    <ErrorNotice error={error} />
    {storageError && <p className="notice" role="status">{tr(storageError)}</p>}
    <div className="audio-output-toolbar">
      <label>{tr("输出声道")}
        <select aria-label={tr("输出声道")} value={config.layout} disabled={!status.supported}
          onChange={(event) => audioOutput.update({ ...config, layout: event.target.value as AudioOutputConfig["layout"] })}>
          {layouts.map((layout) => <option key={layout.value} value={layout.value}
            disabled={layout.channels > 0 && (status.maxChannels === null || layout.channels > status.maxChannels)}>{tr(layout.name)}</option>)}
        </select>
      </label>
      <div className="audio-output-save">
        <span className={dirty ? "dsp-unsaved" : "muted"} role="status">{tr(dirty ? "有未保存的更改" : saved ? "已保存" : "调整时实时试听")}</span>
        <button type="button" disabled={!dirty} onClick={() => audioOutput.revert()}>{tr("撤销更改")}</button>
        <button type="button" className="primary" disabled={!dirty && !storageError} onClick={() => audioOutput.save()}>{tr("保存")}</button>
      </div>
    </div>
    <label className="check-label dsp-toggle">
      <input type="checkbox" checked={config.expandStereo} disabled={!status.supported}
        onChange={(event) => audioOutput.update({ ...config, expandStereo: event.target.checked })} />
      {tr("立体声环绕扩展")}
    </label>
    <p className="muted audio-output-hint">{tr("输出为 5.1 或 7.1 时，将双声道音乐扩展为模拟环绕；关闭时仅保留原有声道。")}</p>
    {status.limited && <p className="notice" role="status">{tr("当前设备无法使用所选布局，已自动使用支持的声道数；保存的偏好不会改变。")}</p>}
    <dl className="audio-output-status">
      <div><dt>{tr("设备最多支持")}</dt><dd>{status.maxChannels === null ? tr("未检测到") : channels(status.maxChannels)}</dd></div>
      <div><dt>{tr("音源声道")}</dt><dd>{channels(status.sourceChannels)}</dd></div>
      <div><dt>{tr("当前输出")}</dt><dd>{channels(status.outputChannels)}</dd></div>
    </dl>
    <div className="audio-output-footer">
      <p className="muted">{tr("设置仅保存在此浏览器。实际扬声器输出取决于系统与音频设备配置。")}</p>
      <button type="button" disabled={!status.supported} onClick={() => services.inspectAudioOutput()}>{tr("重新检测")}</button>
    </div>
  </section>;
}
