import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";
import "./context-menu.css";

export interface MenuAction {
  label: string;
  icon: string;
  disabled?: boolean;
  reason?: string;
  run: () => void;
}

export function ContextMenu({ x, y, label, origin, actions, close }: {
  x: number;
  y: number;
  label: string;
  origin: HTMLElement;
  actions: MenuAction[];
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dismiss = useRef(close);
  dismiss.current = close;
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const menu = ref.current!;
    const bounds = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)),
    });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) dismiss.current();
    };
    const scroll = (event: Event) => {
      if (!menu.contains(event.target as Node)) dismiss.current();
    };
    const resize = () => dismiss.current();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
      if (menu.contains(document.activeElement) || document.activeElement === document.body)
        origin.focus({ preventScroll: true });
    };
  }, [x, y, origin]);
  return createPortal(
    <div ref={ref} role="menu" aria-label={label} className="context-menu" style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          event.stopPropagation();
          close();
          return;
        }
        const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next: number;
        if (event.key === "ArrowDown") next = (current + 1) % buttons.length;
        else if (event.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = buttons.length - 1;
        else return;
        event.preventDefault();
        buttons[next]?.focus();
      }}>
      <div className="context-menu-title" title={label}>{label}</div>
      {actions.map((action) => <button key={action.label} type="button" role="menuitem" tabIndex={-1}
        disabled={action.disabled} title={action.reason}
        onClick={() => { close(); action.run(); }}>
        <Icon name={action.icon} size={17} />{action.label}
      </button>)}
    </div>, document.body,
  );
}
