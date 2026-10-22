import { useEffect, useRef, useState, type PointerEvent } from "react";

interface DragState {
  id: string;
  beforeId: string | null;
  index: number;
  x: number;
  y: number;
}

// 只从手柄开始拖动，避免参数滑杆与触屏滚动误触排序。
export function useDSPDrag(reorder: (id: string, index: number) => void) {
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const current = useRef<DragState | null>(null);
  const pending = useRef<{ id: string; startY: number; pointer: number; x: number; y: number; scroll: HTMLElement | null } | null>(null);
  const frame = useRef<number | null>(null);

  function stop() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = null;
    current.current = null;
    setDrag(null);
  }

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  function locate() {
    const pointer = pending.current;
    if (!pointer || !list.current) return;
    if (!current.current && Math.abs(pointer.y - pointer.startY) < 5) return;
    const cards = Array.from(list.current.children).filter((element) => (element as HTMLElement).dataset.effectId !== pointer.id);
    const index = cards.filter((element) => {
      const box = element.getBoundingClientRect();
      return pointer.y > box.top + box.height / 2;
    }).length;
    const next = { id: pointer.id, beforeId: (cards[index] as HTMLElement | undefined)?.dataset.effectId ?? null,
      index, x: pointer.x, y: pointer.y };
    current.current = next;
    setDrag(next);
  }

  function scrollFrame() {
    const pointer = pending.current;
    if (!pointer) return;
    if (current.current && pointer.scroll) {
      const box = pointer.scroll.getBoundingClientRect();
      const top = Math.max(0, box.top), bottom = Math.min(window.innerHeight, box.bottom);
      const delta = pointer.y < top + 60 ? -Math.min(14, (top + 60 - pointer.y) / 4)
        : pointer.y > bottom - 60 ? Math.min(14, (pointer.y - bottom + 60) / 4) : 0;
      if (delta) { pointer.scroll.scrollTop += delta; locate(); }
    }
    frame.current = requestAnimationFrame(scrollFrame);
  }

  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || !event.isPrimary || pending.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    let scroll: HTMLElement | null = list.current;
    while (scroll && !(scroll.scrollHeight > scroll.clientHeight && /auto|scroll/.test(getComputedStyle(scroll).overflowY))) scroll = scroll.parentElement;
    pending.current = { id, startY: event.clientY, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      scroll: scroll ?? document.scrollingElement as HTMLElement | null };
    frame.current = requestAnimationFrame(scrollFrame);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    if (pending.current?.pointer !== event.pointerId) return;
    pending.current.x = event.clientX;
    pending.current.y = event.clientY;
    locate();
  }

  function end(event: PointerEvent<HTMLButtonElement>) {
    if (pending.current?.pointer !== event.pointerId) return;
    const result = current.current;
    stop();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (result) reorder(result.id, result.index);
  }

  return { list, drag, start, move, end, cancel: stop };
}
