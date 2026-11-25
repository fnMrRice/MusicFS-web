import { tr, useLocale } from "../i18n";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./ui";
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    // 默认聚焦标题，避免关闭按钮触发常驻提示；保留内容区自行指定的焦点。
    if (heading.current?.parentElement?.contains(document.activeElement)) {
      heading.current.focus({ preventScroll: true });
    }
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        // 点击内边距和遮罩时，事件目标都是 dialog，只有边界外的点击才关闭弹窗。
        const { left, right, top, bottom } = e.currentTarget.getBoundingClientRect();
        if (e.clientX < left || e.clientX >= right || e.clientY < top || e.clientY >= bottom) close();
      }}
    >
      <div className="section-title">
        <h2 ref={heading} tabIndex={-1}>{title}</h2>
        <IconButton icon="close" label={tr("关闭")} onClick={close} />
      </div>
      {children}
    </dialog>,
    document.body,
  );
}
