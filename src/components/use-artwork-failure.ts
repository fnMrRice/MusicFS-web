import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { onlineArtworkPath } from "../api/artwork";

export function useArtworkFailure(source?: string | null) {
  const [failure, setFailure] = useState<{ source: string; container: Element } | null>(null);
  const retried = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!failure || failure.source !== source || retried.current === source || !onlineArtworkPath(source)) return;
    // 仅给仍在视口内的在线封面一次错峰重试。标签页在后台时不发请求。
    let visible = false;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (!visible || document.hidden) return;
      timer = window.setTimeout(() => {
        retried.current = source;
        setFailure(null);
      }, 10_000 + Math.random() * 5_000);
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      schedule();
    });
    observer.observe(failure.container);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [failure, source]);
  return {
    failed: !!source && failure?.source === source,
    onError: (event: SyntheticEvent<HTMLImageElement>) => {
      const container = event.currentTarget.parentElement;
      if (source && container) setFailure({ source, container });
    },
  };
}
