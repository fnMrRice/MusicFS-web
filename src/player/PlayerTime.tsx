import { useState } from "react";
import { duration } from "../components/ui";
import { tr, useLocale } from "../i18n";

export function PlayerTime({ positionMs, durationMs }: { positionMs: number; durationMs: number | null }) {
  useLocale();
  const [leftRemaining, setLeftRemaining] = useState(false);
  const [rightRemaining, setRightRemaining] = useState(false);
  const position = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  const total = durationMs !== null && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
  const remaining = total === null ? "—" : `-${duration(Math.max(0, total - position))}`;
  const left = leftRemaining ? remaining : duration(position);
  const right = rightRemaining ? remaining : duration(total);
  const leftLabel = tr(leftRemaining ? "剩余时间，点击显示当前时间" : "当前时间，点击显示剩余时间");
  const rightLabel = tr(rightRemaining ? "剩余时间，点击显示总时间" : "总时间，点击显示剩余时间");
  return <span className="time">
    <button type="button" aria-label={leftLabel} aria-description={left} title={leftLabel}
      aria-pressed={leftRemaining} onClick={() => setLeftRemaining((value) => !value)}>{left}</button>
    <span aria-hidden="true"> / </span>
    <button type="button" className="time-secondary" aria-label={rightLabel} aria-description={right} title={rightLabel}
      aria-pressed={rightRemaining} onClick={() => setRightRemaining((value) => !value)}>{right}</button>
  </span>;
}
