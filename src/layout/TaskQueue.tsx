import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useServices, useStore } from "../app/services";
import { ErrorNotice, IconButton } from "../components/ui";
import { tr, useLocale } from "../i18n";
import { RefreshSubmissions } from "../tasks/RefreshSubmissions";
import { TaskQueueItem } from "./TaskQueueItem";
import styles from "./TaskQueue.module.css";

export function TaskQueue() {
  useLocale();
  const services = useServices(), value = useStore(services.tasks), auth = useStore(services.auth);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), id = useId(), location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void services.tasks.refresh(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [services]);
  useEffect(() => {
    if (!open) return;
    void services.tasks.refresh();
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); root.current?.querySelector("button")?.focus(); }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open, services]);
  if (!auth.session) return null;
  return <div className={styles.root} ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); root.current?.querySelector("button")?.focus(); }
  }}>
    <div className={styles.trigger}>
      <IconButton icon="queue" label={tr("任务队列")} aria-expanded={open} aria-controls={open ? id : undefined}
        aria-describedby={`${id}-count`} onClick={() => setOpen(current => !current)} />
      {value.activeCount > 0 && <span className={styles.badge} aria-hidden="true">{value.activeCount > 99 ? "99+" : value.activeCount}</span>}
    </div>
    <span id={`${id}-count`} className={styles.accessible} role="status">{tr("{0} 个任务进行中", { 0: value.activeCount })}</span>
    {open && <section className={`${styles.panel} popover`} id={id} aria-label={tr("任务队列详情")}>
      <div className={styles.heading}><h2 tabIndex={-1} data-queue-heading>{tr("任务队列")}</h2>
        <IconButton icon="close" label={tr("关闭任务队列")} onClick={() => { setOpen(false); root.current?.querySelector("button")?.focus(); }} />
      </div>
      {auth.session.user.role === "admin" && <div className={styles.scope} role="group" aria-label={tr("任务范围")}>
        <button type="button" aria-pressed={value.scope === "mine"} onClick={() => services.tasks.setScope("mine")}>{tr("我的任务")}</button>
        <button type="button" aria-pressed={value.scope === "all"} onClick={() => services.tasks.setScope("all")}>{tr("所有任务")}</button>
      </div>}
      <div className={styles.content}>
        <RefreshSubmissions />
        <ErrorNotice error={value.error} retry={() => void services.tasks.refresh()} />
        {!value.items.length && <p className={styles.empty}>{tr(value.loading ? "正在读取任务…" : value.error ? "暂时无法读取任务。" : "暂无刷新任务")}</p>}
        <ul className={styles.list} aria-label={tr(value.scope === "all" ? "所有任务" : "我的任务")}>
          {value.items.map(task => <TaskQueueItem key={task.id} task={task} showOwner={value.scope === "all"}
            cancelling={value.cancelling.includes(task.id)} error={value.cancelErrors[task.id] ?? null}
            cancel={() => void services.tasks.cancel(task.id).then(() => {
              if (!root.current?.contains(document.activeElement)) root.current?.querySelector<HTMLElement>("[data-queue-heading]")?.focus();
            })} />)}
        </ul>
        {value.nextCursor && <button className={styles.more} type="button" disabled={value.loading} onClick={() => void services.tasks.more()}>{tr("加载更多")}</button>}
      </div>
      <p className={styles.note}>{tr("离开当前页面后，任务仍会继续。中断不会撤销已完成的结果。")}</p>
    </section>}
  </div>;
}
