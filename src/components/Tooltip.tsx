import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Tooltip({ label, disabled = false, children }: {
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed && !disabled;

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const bounds = anchor.current.getBoundingClientRect();
    const tooltip = tip.current;
    const { width, height } = tooltip.getBoundingClientRect();
    const margin = 8;
    const gap = 9;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const above = bounds.top - height - gap;
    const below = bounds.bottom + gap;
    const preferAbove = !!anchor.current.closest(".player");
    const top = (preferAbove || below + height > viewportHeight - margin) && above >= margin ? above : below;
    tooltip.style.left = `${Math.max(margin, Math.min(bounds.left + (bounds.width - width) / 2, viewportWidth - width - margin))}px`;
    tooltip.style.top = `${Math.max(margin, Math.min(top, viewportHeight - height - margin))}px`;

    const dismiss = () => setDismissed(true);
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    document.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("keydown", keydown);
    };
  }, [open, label]);

  return <span ref={anchor} className="tip-wrap"
    onMouseEnter={() => { setHovered(true); setDismissed(false); }}
    onMouseLeave={() => { setHovered(false); setDismissed(false); }}
    onFocus={() => { setFocused(true); setDismissed(false); }}
    onBlur={() => { setFocused(false); setDismissed(false); }}>
    {children}
    {open && createPortal(
      <span ref={tip} role="tooltip" className="tooltip" data-keyboard={focused}>{label}</span>,
      anchor.current?.closest("dialog") ?? document.body,
    )}
  </span>;
}
