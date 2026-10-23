import { useLocale } from "../../i18n";
import "./dsp.css";
import { LocalDSPSettings } from "./LocalDSPSettings";
import { AudioOutputSettings } from "./AudioOutputSettings";

export function DSPSettings() {
  useLocale();
  return <div className="settings-card dsp-settings-stack">
    <LocalDSPSettings />
    <AudioOutputSettings />
  </div>;
}
