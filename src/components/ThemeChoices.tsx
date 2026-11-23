import { useServices, useStore } from "../app/services";
import { tr } from "../i18n";
import "./theme-choices.css";

const modes = [
  ["dark", "深夜 · 深色"],
  ["light", "晨光 · 浅色"],
  ["system", "跟随系统"],
] as const;

const accents = [
  ["default", "默认"],
  ["miku", "初音绿"],
  ["tianyi", "天依蓝"],
] as const;

export function ThemeChoices() {
  const services = useServices();
  const prefs = useStore(services.preferences);
  return (
    <div className="theme-choices">
      <fieldset>
        <legend>{tr("明暗模式")}</legend>
        <div className="theme-options">
          {modes.map(([mode, label]) => (
            <button key={mode} type="button" aria-pressed={prefs.theme === mode}
              onClick={() => services.preference({ theme: mode })}>
              {tr(label)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>{tr("主题色")}</legend>
        <div className="theme-options">
          {accents.map(([accent, label]) => (
            <button key={accent} type="button" aria-pressed={prefs.accent === accent}
              onClick={() => services.preference({ accent })}>
              <span aria-hidden="true" className="accent-swatch" style={{ backgroundColor: `var(--accent-${accent})` }} />
              {tr(label)}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
