import { useEffect, useRef } from "react";

/** 恢复可见或重新获得焦点时再读取，后台标签页不主动更新。 */
export function useForeground(enabled: boolean, read: () => void) {
  const current = useRef(read);
  current.current = read;
  useEffect(() => {
    if (!enabled) return;
    const resume = () => { if (!document.hidden) current.current(); };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled]);
}
