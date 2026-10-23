import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

export const settingsSections = [
  { id: "sources", label: "音乐源" },
  { id: "plugins", label: "插件管理" },
  { id: "playback", label: "播放配置" },
  { id: "dsp", label: "音效与输出" },
  { id: "appearance", label: "外观与语言" },
  { id: "user", label: "用户" },
  { id: "about", label: "关于" },
] as const;
type SectionId = (typeof settingsSections)[number]["id"];

export function useSettingsNavigation() {
  const [query, setQuery] = useSearchParams();
  const location = useLocation();
  const requested = query.get("tab") === "other" ? "appearance" : query.get("tab");
  const target = query.has("directories") ? "sources"
    : settingsSections.find((section) => section.id === requested)?.id ?? "sources";
  const [active, setActive] = useState<SectionId>(target);
  const page = useRef<HTMLElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const anchor = useRef<SectionId | null>(target);
  const moving = useRef<SectionId | null>(null);
  const smooth = useRef(false);
  const focusTarget = useRef(false);
  const firstNavigation = useRef(true);

  function scrollTo(id: SectionId, behavior: ScrollBehavior = "auto") {
    const root = page.current?.closest<HTMLElement>("#page-scroll");
    const section = page.current?.querySelector<HTMLElement>(`#settings-panel-${id}`);
    if (!root || !section) return;
    if (focusTarget.current) {
      section.focus({ preventScroll: true });
      focusTarget.current = false;
    }
    const offset = (navigation.current?.offsetHeight ?? 0) + 20;
    const top = root.scrollTop + section.getBoundingClientRect().top - root.getBoundingClientRect().top - offset;
    root.scrollTo({ top: Math.max(0, top), behavior });
  }

  function select(id: SectionId, keyboard = false) {
    const next = new URLSearchParams(query);
    next.set("tab", id);
    next.delete("directories");
    anchor.current = id;
    moving.current = id;
    focusTarget.current = keyboard;
    smooth.current = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setActive(id);
    if (next.toString() === query.toString()) {
      scrollTo(id, smooth.current ? "smooth" : "auto");
    } else {
      setQuery(next, { replace: true });
    }
  }

  useEffect(() => {
    const root = page.current?.closest<HTMLElement>("#page-scroll");
    if (firstNavigation.current && root?.dataset.restoredScrollKey === location.key) {
      firstNavigation.current = false;
      anchor.current = null;
      moving.current = null;
      return;
    }
    firstNavigation.current = false;
    anchor.current = target;
    moving.current = target;
    setActive(target);
    const frame = requestAnimationFrame(() => {
      scrollTo(target, smooth.current ? "smooth" : "auto");
      smooth.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [target, query.toString()]);

  useEffect(() => {
    const root = page.current?.closest<HTMLElement>("#page-scroll");
    if (!root || !page.current || !navigation.current) return;
    let frame = 0;
    function update() {
      frame = 0;
      if (!root) return;
      const line = root.getBoundingClientRect().top + (navigation.current?.offsetHeight ?? 0) + 24;
      let current: SectionId = "sources";
      for (const section of settingsSections) {
        const element = page.current?.querySelector(`#settings-panel-${section.id}`);
        if (element && element.getBoundingClientRect().top <= line) current = section.id;
      }
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = "about";
      setActive(moving.current ?? current);
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const cancelAnchor = () => { anchor.current = null; moving.current = null; };
    const end = () => { moving.current = null; schedule(); };
    // 异步来源与插件加载会改变上方高度，用户主动操作前保持深链接的定位。
    const resize = new ResizeObserver(() => {
      page.current?.style.setProperty("--settings-viewport", `${root.clientHeight}px`);
      page.current?.style.setProperty("--settings-navigation-height", `${navigation.current?.offsetHeight ?? 0}px`);
      if (anchor.current) scrollTo(anchor.current);
      schedule();
    });
    resize.observe(page.current);
    resize.observe(navigation.current);
    resize.observe(root);
    root.addEventListener("scroll", schedule, { passive: true });
    root.addEventListener("scrollend", end);
    root.addEventListener("wheel", cancelAnchor, { passive: true });
    root.addEventListener("pointerdown", cancelAnchor);
    root.addEventListener("keydown", cancelAnchor);
    schedule();
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", schedule);
      root.removeEventListener("scrollend", end);
      root.removeEventListener("wheel", cancelAnchor);
      root.removeEventListener("pointerdown", cancelAnchor);
      root.removeEventListener("keydown", cancelAnchor);
    };
  }, []);

  useEffect(() => {
    const nav = navigation.current;
    const button = nav?.querySelector<HTMLElement>(`[aria-controls="settings-panel-${active}"]`);
    if (!nav || !button) return;
    const left = button.offsetLeft;
    if (left < nav.scrollLeft || left + button.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({ left: left - (nav.clientWidth - button.offsetWidth) / 2 });
    }
  }, [active]);

  return { page, navigation, active, select };
}
