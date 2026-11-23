import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { PluginSettingsApi, settingsValid, settingsValues, type PluginJob, type PluginSettings as Settings, type SettingValue, type SettingsRequest } from "../../api/plugin-settings";
import { useServices } from "../../app/services";
import { localizedPluginText } from "../../components/source-name";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { SettingField } from "./SettingField";
import { PluginJobStatus } from "./PluginJobStatus";
import "./settings.css";

type Pending = { key: string } & ({ kind: "save"; request: SettingsRequest } | { kind: "action"; action: string });

export function PluginSettings({ pluginId, busyChanged, cancel }: {
  pluginId: string; busyChanged?: (busy: boolean) => void; cancel?: () => void;
}) {
  const { locale } = useLocale();
  const services = useServices();
  const api = useMemo(() => new PluginSettingsApi(services.client, pluginId), [services, pluginId]);
  const [data, setData] = useState<Settings | null>(null);
  const [values, setValues] = useState<Record<string, SettingValue>>({});
  const [job, setJob] = useState<PluginJob | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<Pending | null>(null);
  const control = useRef<AbortController | null>(null);
  const refreshJob = useRef<() => void>(() => {});
  const mutation = useRef(0);
  const dirty = !!data && JSON.stringify(values) !== JSON.stringify(settingsValues(data));
  const active = job?.status === "running" || job?.status === "queued";
  useEffect(() => {
    let initial = true, hasJobs = true;
    setLoading(true); setError(null); setJobError(null); setMessage("");
    const watcher = services.activity.watch("pluginJobs", async signal => {
      if (!hasJobs || control.current) return;
      const generation = mutation.current;
      try {
        const result = await api.get(signal);
        if (signal.aborted || generation !== mutation.current) return;
        if (initial) {
          setData(result); setValues(settingsValues(result)); setLoading(false); setError(null);
          pending.current = null; setUncertain(false); setConflict(false);
          initial = false;
        }
        hasJobs = result.schema.actions.length > 0 || !!result.job;
        setJob(result.job); setJobError(null);
      } catch (cause) {
        if (signal.aborted || generation !== mutation.current) return;
        if (initial) { setError(errorMessage(cause)); setLoading(false); }
        else setJobError(errorMessage(cause));
      }
    });
    refreshJob.current = watcher.refresh;
    return watcher.stop;
  }, [api, services, epoch]);
  useEffect(() => () => control.current?.abort(), []);
  async function submit(input?: Pending) {
    if (control.current || conflict) return;
    if (!pending.current && input) pending.current = input;
    const operation = pending.current;
    if (!operation) return;
    const controller = new AbortController();
    ++mutation.current;
    control.current = controller;
    setBusy(true); busyChanged?.(true); setError(null); setMessage("");
    try {
      if (operation.kind === "save") {
        const result = await api.save(operation.request, operation.key, controller.signal);
        if (controller.signal.aborted) return;
        setData(result); setValues(settingsValues(result)); setJob(result.job); setMessage("设置已保存。");
      } else {
        const result = await api.action(operation.action, operation.key, controller.signal);
        if (controller.signal.aborted) return;
        setJob(result); setMessage("任务已提交，可离开此页面，服务端会继续执行。");
      }
      pending.current = null; setUncertain(false);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const stale = cause instanceof ApiError && (cause.status === 409 || cause.status === 412 || cause.code === "REVISION_CONFLICT");
      const unknown = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
      setConflict(stale); setUncertain(unknown);
      if (!unknown) pending.current = null;
      setError(stale ? "插件设置已发生变化，请重新加载后再编辑。"
        : cause instanceof ApiError && cause.code === "INVALID_ARGUMENT"
          ? "配置内容无效，请检查填写格式后重试。" : errorMessage(cause));
    } finally {
      control.current = null;
      if (!controller.signal.aborted) { setBusy(false); busyChanged?.(false); refreshJob.current(); }
    }
  }
  const title = data ? localizedPluginText(data.schema.title, data.schema.localizedTitles, locale) : tr("插件设置");
  return <section className="plugin-settings" aria-label={title}>
    <h4>{title}</h4>
    {loading && <p role="status">{tr("正在读取设置…")}</p>}
    <ErrorNotice error={error} />
    {(!data || conflict || uncertain) && !loading && <div className="list-actions">
      {uncertain && <button disabled={busy} onClick={() => { void submit(); }}>{tr("重试上次操作")}</button>}
      <button disabled={busy} onClick={() => setEpoch((value) => value + 1)}>{tr("重新加载设置")}</button>
    </div>}
    {data && <>
      {data.schema.description && <p className="muted">{localizedPluginText(data.schema.description, data.schema.localizedDescriptions, locale)}</p>}
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!settingsValid(data.schema, values) || !dirty || conflict || uncertain) return;
        void submit({ kind: "save", key: crypto.randomUUID(), request: { expectedRevision: data.revision, schemaRevision: data.schema.revision, values } });
      }}>
        <div className="plugin-settings-fields">{data.schema.fields.map((field) => <SettingField key={field.key} field={field} value={values[field.key]}
          disabled={loading || busy || conflict || uncertain} change={(value) => setValues((previous) => ({ ...previous, [field.key]: value }))} />)}</div>
        <div className="plugin-settings-footer">
          {data.schema.fields.length > 0 && <button className="primary" disabled={loading || busy || !dirty || conflict || uncertain || !settingsValid(data.schema, values)}>
            {busy ? tr("正在保存…") : tr("保存设置")}
          </button>}
          {cancel && <button type="button" disabled={busy} onClick={cancel}>{tr("取消")}</button>}
        </div>
      </form>
      {dirty && data.schema.actions.length > 0 && <p className="muted">{tr("请先保存修改，再执行插件操作。")}</p>}
      <div className="plugin-settings-actions">{data.schema.actions.map((action) => <div key={action.id}>
        <button disabled={loading || busy || dirty || conflict || uncertain || active} onClick={() => {
          void submit({ kind: "action", action: action.id, key: crypto.randomUUID() });
        }}>{localizedPluginText(action.label, action.localizedLabels, locale)}</button>
        {action.description && <p className="muted">{localizedPluginText(action.description, action.localizedDescriptions, locale)}</p>}
      </div>)}</div>
      {message && <p className="feedback" role="status">{tr(message)}</p>}
      {(data.schema.actions.length > 0 || job && job.status !== "idle") && <PluginJobStatus job={job} />}
      <ErrorNotice error={jobError} retry={() => refreshJob.current()} />
    </>}
    {!data && cancel && <div className="plugin-settings-footer"><button type="button" disabled={busy} onClick={cancel}>{tr("取消")}</button></div>}
  </section>;
}
