import { useState } from "react";
import { tr, useLocale } from "../../i18n";
import { LocalDSPSettings } from "./LocalDSPSettings";
import { ServerDSPSettings } from "./ServerDSPSettings";
import "./dsp.css";

export function DSPSettings() {
  useLocale();
  const [scope, setScope] = useState<"local" | "server">("local");
  return <>
    <div className="dsp-scope" role="group" aria-label={tr("音频处理位置")}>
      <button type="button" aria-pressed={scope === "local"} onClick={() => setScope("local")}>{tr("本地音效")}</button>
      <button type="button" aria-pressed={scope === "server"} onClick={() => setScope("server")}>{tr("服务端格式转换")}</button>
    </div>
    {scope === "local" ? <LocalDSPSettings /> : <ServerDSPSettings />}
  </>;
}
