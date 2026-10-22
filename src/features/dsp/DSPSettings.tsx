import { useState } from "react";
import { tr, useLocale } from "../../i18n";
import "./dsp.css";
import { LocalDSPSettings } from "./LocalDSPSettings";
import { AudioOutputSettings } from "./AudioOutputSettings";

export function DSPSettings() {
  useLocale();
  const [scope, setScope] = useState<"local" | "output">("local");
  return <>
    <div className="dsp-scope" role="group" aria-label={tr("音频处理位置")}>
      <button type="button" aria-pressed={scope === "local"} onClick={() => setScope("local")}>{tr("本地音效")}</button>
      <button type="button" aria-pressed={scope === "output"} onClick={() => setScope("output")}>{tr("输出设置")}</button>
    </div>
    {scope === "local" ? <LocalDSPSettings /> : <AudioOutputSettings />}
  </>;
}
