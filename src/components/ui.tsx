import { tr, useLocale, statusText } from "../i18n";
import { useServices } from "../app/services";
import { Tooltip } from "./Tooltip";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

const paths: Record<string, ReactNode> = {
  music: (
    <>
      <path d="M9 18V5l12-2v13M9 8l12-2" />
      <ellipse cx="6" cy="18" rx="3" ry="3" />
      <ellipse cx="18" cy="16" rx="3" ry="3" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6" />
    </>
  ),
  home: (
    <>
      <path d="m3 11 9-8 9 8v10H3ZM9 21v-8h6v8" />
    </>
  ),
  folder: <path d="M3 7V4h6l3 3h9v13H3Z" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 10h18m-12 5 2 2 4-4" /></>,
  heart: <path d="M12 21 3.5 12.5C-2 6 6 0 12 7c6-7 14-1 8.5 5.5Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  settings: (
    <>
      <path d="m9 3-1 3-3 1-2 4 2 2v4l4 3 3-1 3 1 4-3v-4l2-2-2-4-3-1-1-3Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="3" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" />
    </>
  ),
  theme: <path d="m8 3-5 3-2 5 5 2v8h12v-8l5-2-2-5-5-3c0 5-8 5-8 0Z" />,
  back: <path d="m15 4-8 8 8 8" />,
  next: (
    <>
      <path d="m6 4 12 8-12 8Z" />
      <path d="M20 4v16" />
    </>
  ),
  previous: (
    <>
      <path d="m18 4-12 8 12 8Z" />
      <path d="M4 4v16" />
    </>
  ),
  play: <path d="m7 3 14 9-14 9Z" />,
  pause: (
    <>
      <path d="M7 4v16M17 4v16" />
    </>
  ),
  stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  grid: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  queue: (
    <>
      <path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01" />
    </>
  ),
  repeat: (
    <>
      <path d="m18 2 4 4-4 4M22 6H6a4 4 0 0 0-4 4m4 12-4-4 4-4m-4 4h16a4 4 0 0 0 4-4" />
    </>
  ),
  "repeat-one": (
    <>
      <path d="m18 2 4 4-4 4M22 6H6a4 4 0 0 0-4 4m4 12-4-4 4-4m-4 4h16a4 4 0 0 0 4-4" />
      <path d="m10 11 2-2v6m-2 0h4" />
    </>
  ),
  sequence: <path d="M4 6h16M4 12h16M4 18h16m-4-4 4 4-4 4" />,
  shuffle: <path d="M3 6h2c5 0 9 12 14 12h2m-4-4 4 4-4 4M3 18h2c2 0 4-2 6-5m3-4c2-2 3-3 5-3h2m-4-4 4 4-4 4" />,
  volume: (
    <>
      <path d="m11 3-6 5H2v8h3l6 5ZM15 7c4 2 4 8 0 10m3-13c7 4 7 12 0 16" />
    </>
  ),
  "volume-muted": (
    <>
      <path d="m11 3-6 5H2v8h3l6 5Z" />
      <path d="m3 3 18 18" />
    </>
  ),
  plus: <path d="M12 4v16M4 12h16" />,
  more: (
    <>
      <circle cx="4" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="20" cy="12" r="1" />
    </>
  ),
  chevron: <path d="m5 9 7 7 7-7" />,
  refresh: (
    <>
      <path d="M20 4v6h-6M4 20v-6h6" />
      <path d="M20 10A8 8 0 0 0 6 5M4 14a8 8 0 0 0 14 5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M3 22v-3a9 9 0 0 1 18 0v3" />
    </>
  ),
  close: <path d="m5 5 14 14M19 5 5 19" />,
  pin: <path d="M16 9V4l1-1H7l1 1v5l-3 3v2h14v-2l-3-3ZM12 14v8" />,
  album: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  disc: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2" />
      <path d="M5.5 10A7 7 0 0 1 10 5.5M14 18.5a7 7 0 0 0 4.5-4.5" />
    </>
  ),
  headphones: <path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v8h4v-8Zm16 0h1v8h-4v-8Z" />,
  radio: <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="m5 8 14-5M13 12h5m-5 4h3" /><circle cx="8" cy="14" r="2" /></>,
  lyrics: (
    <>
      <path d="M4 5h16M4 10h10M4 15h16M4 20h10" />
    </>
  ),
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  useLocale();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {Object.hasOwn(paths, name) ? paths[name] : paths.music}
    </svg>
  );
}
export function SectionToggle({ title, expanded, controls, onClick }: {
  title: string; expanded: boolean; controls: string; onClick: () => void;
}) {
  return <button type="button" className="section-toggle" aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
    <Icon name="chevron" size={14} /><span>{title}</span>
  </button>;
}

export function IconButton({
  icon,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  useLocale();
  return (
    <Tooltip label={label} disabled={props["aria-expanded"] === true || props["aria-expanded"] === "true"}>
      <button
        type="button"
        {...props}
        aria-label={label}
        className={`icon-button ${props.className ?? ""}`}
      >
        <Icon name={icon} />
      </button>
    </Tooltip>
  );
}
export function Empty({
  title,
  children,
  icon = "music",
}: {
  title: string;
  children?: ReactNode;
  icon?: string;
}) {
  useLocale();
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={36} />
      </div>
      <h2>{title}</h2>
      <div className="muted">{children}</div>
    </div>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: string | null;
  retry?: () => void;
}) {
  useLocale();
  return error ? (
    <div className="notice error" role="alert">
      {statusText(error)}
      {retry && <button type="button" onClick={retry}>{tr("重试")}</button>}
    </div>
  ) : null;
}
export function Sentinel({
  active,
  load,
}: {
  active: boolean;
  load: () => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(load);
  callback.current = load;
  useEffect(() => {
    if (!active || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) callback.current();
      },
      { root: document.querySelector("#page-scroll"), rootMargin: "180px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [active]);
  return <div ref={ref} className="sentinel" aria-hidden="true" />;
}
export function Cover({ large = false, objectId, src, alt = "" }: {
  large?: boolean; objectId?: string | null; src?: string; alt?: string;
}) {
  const s = useServices();
  const source = objectId ? s.client.url(`/media/${encodeURIComponent(objectId)}`) : src;
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={`cover ${large ? "large" : ""}`}>
      {source && source !== failed ? <img key={source} src={source} alt={alt}
        loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(source)} /> : <Icon name="music" size={large ? 46 : 22} />}
    </span>
  );
}
export function duration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
