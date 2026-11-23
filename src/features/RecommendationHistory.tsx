import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../components/ui";
import { tr } from "../i18n";

interface Props {
  depth: number;
  offset: number;
  loading: boolean;
  select: (offset: number) => void;
}

export function RecommendationHistory({ depth, offset, loading, select }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const label = (index: number) => index === 0 ? tr("最新推荐") : tr("历史推荐（{0}/{1}）", { 0: index, 1: depth });

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  return <div className="recommendation-history" ref={root}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        close();
      }
    }}>
    <button type="button" className="recommendation-history-trigger" ref={trigger} aria-label={tr("时光机")}
      title={offset ? label(offset) : tr("时光机")} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} disabled={!depth && !offset} onClick={() => setOpen(!open)}>
      <Icon name="clock" size={16} /><span>{tr("时光机")}{offset > 0 && ` · ${offset}/${depth}`}</span>
    </button>
    {open && <div className="popover recommendation-history-popup" id={id} role="dialog" aria-label={tr("时光机")}>
      {Array.from({ length: depth + 1 }, (_, index) => (
        <button key={index} type="button" aria-pressed={index === offset} disabled={loading}
          onClick={() => { close(); select(index); }}>{label(index)}</button>
      ))}
    </div>}
  </div>;
}
