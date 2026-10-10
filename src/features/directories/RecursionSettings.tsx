import { useId, useState } from "react";
import type { ImportDefaults } from "../../api/directories";
import { tr } from "../../i18n";

export function RecursionSettings({ value, disabled, change, advanced }: {
  value: ImportDefaults;
  disabled: boolean;
  change: (recursive: boolean, maxDepth: number) => void;
  advanced: (options: Pick<ImportDefaults, "skipHidden" | "respectNoMedia">) => void;
}) {
  const hint = useId();
  const [limited, setLimited] = useState(value.maxDepth > 0);
  const [depth, setDepth] = useState(String(value.maxDepth || 1));
  const valid = /^\d+$/.test(depth) && Number(depth) <= 64;
  return <fieldset className="directory-recursion" disabled={disabled}>
    <legend>{tr("查找设置")}</legend>
    <label className="check-label"><input type="checkbox" checked={value.recursive}
      onChange={(event) => { setLimited(false); change(event.target.checked, 0); }} />
      {tr("递归查找子目录")}</label>
    <details className="directory-advanced">
      <summary>{tr("高级选项")}</summary>
      <div className="directory-depth">
        <label className="check-label"><input type="checkbox" checked={limited} disabled={!value.recursive}
          onChange={(event) => {
            setLimited(event.target.checked);
            change(value.recursive, event.target.checked && valid ? Number(depth) : 0);
          }} />{tr("限制递归深度")}</label>
        <label className="directory-depth-value">{tr("递归深度")}
          <input type="number" min="0" max="64" step="1" required value={limited ? depth : "0"}
            disabled={!value.recursive || !limited} aria-describedby={hint} aria-invalid={!valid}
            onChange={(event) => {
              const next = event.target.value;
              setDepth(next);
              if (/^\d+$/.test(next) && Number(next) <= 64) change(value.recursive, Number(next));
            }} /></label>
      </div>
      <p id={hint} className="muted">{tr("0 表示全部递归")}</p>
      <label className="check-label"><input type="checkbox" checked={!value.skipHidden}
        onChange={(event) => advanced({ skipHidden: !event.target.checked, respectNoMedia: value.respectNoMedia })} />
        {tr("包含隐藏文件和目录")}</label>
      <p className="muted">{tr("包括以 . 开头的文件、目录和 Windows 隐藏项。")}</p>
      <label className="check-label"><input type="checkbox" checked={value.respectNoMedia}
        onChange={(event) => advanced({ skipHidden: value.skipHidden, respectNoMedia: event.target.checked })} />
        {tr("遵循 .nomedia 标记")}</label>
      <p className="muted">{tr("跳过包含 .nomedia 的目录及其子目录。")}</p>
    </details>
  </fieldset>;
}
