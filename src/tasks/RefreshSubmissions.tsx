import { useServices, useStore } from "../app/services";
import { ErrorNotice } from "../components/ui";
import { statusText, tr } from "../i18n";

export function RefreshSubmissions({ provider }: { provider?: string }) {
  const services = useServices();
  const value = useStore(services.refreshSubmissions);
  const pending = value.pending.filter(item => !provider || item.provider === provider);
  const notice = provider ? value.notices[provider] : null;
  return <div className="refresh-submissions">
    {provider && <ErrorNotice error={value.errors[provider]?.message ?? null}
      retry={() => void services.refreshSubmissions.start(provider, value.errors[provider]?.root)} />}
    {notice && notice.submitted + notice.merged > 0 && <p className="muted" role="status">
      {tr("已加入 {0} 个目录，{1} 个目录已在队列中。", { 0: notice.submitted, 1: notice.merged })}
    </p>}
    {pending.map(item => <div key={item.key} className={`notice ${item.error ? "error" : ""}`} role={item.error ? "alert" : "status"}>
      <span>{item.name} · {item.error ? statusText(item.error) : tr("正在加入队列…")}</span>
      {item.error && <button type="button" disabled={item.sending} onClick={() => void services.refreshSubmissions.retry(item.key)}>
        {tr(item.rejected ? "重新提交" : "继续确认")}</button>}
      {item.rejected && !item.sending && <button type="button" onClick={() => services.refreshSubmissions.dismiss(item.key)}>{tr("移除失败项")}</button>}
    </div>)}
  </div>;
}
