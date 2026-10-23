import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Icon, IconButton } from "../components/ui";
import { tr, useLocale } from "../i18n";
import { useServiceStatus, type ServicePhase } from "./use-service-status";
import styles from "./ServiceStatus.module.css";

const messages: Record<ServicePhase, [string, string]> = {
  checking: ["正在检查…", "正在检查音乐服务是否可用。"],
  ready: ["运行正常", "音乐服务已就绪，可以接收请求。"],
  online: ["已连接", "音乐服务连接在线，业务就绪状态尚未确认。"],
  "not-ready": ["服务未就绪", "音乐服务暂不可用，请稍后重新检查。"],
  unreachable: ["无法连接", "无法连接音乐服务，请检查网络或稍后重试。"],
  incompatible: ["服务不兼容", "音乐服务返回的数据或协议不兼容。"],
  changed: ["服务已变更", "当前音乐服务已变更，请刷新页面后重新连接。"],
  error: ["服务异常", "音乐服务检查失败，请稍后重试。"],
};

export function ServiceStatus() {
  const { locale } = useLocale();
  const status = useServiceStatus();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const location = useLocation();
  const [label, description] = messages[status.phase];
  const tone = status.phase === "ready" || status.phase === "online" ? "healthy"
    : status.phase === "checking" ? "checking"
      : ["not-ready", "changed", "incompatible"].includes(status.phase) ? "warning" : "failed";

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return <div className={styles.root} ref={root} data-state={status.phase}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        setOpen(false);
        root.current?.querySelector("button")?.focus();
      }
    }}>
    <div className={styles.trigger}>
      <IconButton icon="server" label={tr("服务状态")} aria-expanded={open}
        aria-controls={open ? id : undefined} aria-describedby={`${id}-status`}
        onClick={() => setOpen((value) => !value)} />
      <span className={`${styles.dot} ${styles.indicator} ${styles[tone]}`} aria-hidden="true" />
    </div>
    <span className={styles.accessible} id={`${id}-status`} role="status">{tr(label)}</span>
    {open && <section id={id} className={`${styles.panel} popover`} aria-label={tr("服务状态详情")}>
      <h2>{tr("服务状态")}</h2>
      <div className={styles.summary}>
        <span className={`${styles.dot} ${styles[tone]}`} aria-hidden="true" />
        <strong>{tr(label)}</strong>
      </div>
      <p>{tr(description)}</p>
      <p className={styles.note}>{tr("音乐来源与插件状态可在设置中查看。")}</p>
      <div className={styles.footer}>
        <small>{status.checkedAt === null ? tr("尚未完成检查") : tr("上次检查：{0}", {
          0: new Date(status.checkedAt).toLocaleTimeString(locale),
        })}</small>
        <button type="button" aria-disabled={status.checking} onClick={() => {
          if (!status.checking) status.refresh();
        }}>
          <Icon name="refresh" size={14} />{tr(status.checking ? "正在检查…" : "重新检查")}
        </button>
      </div>
    </section>}
  </div>;
}
