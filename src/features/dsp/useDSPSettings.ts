import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { DSPApi, dspError, type DSPSaveRequest, type DSPSettingsPage, type DSPValidation } from "../../api/dsp";
import { useServices } from "../../app/services";
import { draftOf, settingsFingerprint, settingsOf, validDraft, type DSPDraft } from "./model";

// 格式转换页面不读取或重新提交服务端保存的音效链。
function formatPage(page: DSPSettingsPage): DSPSettingsPage {
  return { ...page, settings: { ...page.settings, chain: [] }, defaults: { ...page.defaults, chain: [] } };
}

export function useDSPSettings(scope: "personal" | "global", refreshToken = 0, saved?: () => void) {
  const services = useServices();
  const api = useMemo(() => new DSPApi(services.client, scope), [services, scope]);
  const [data, setData] = useState<DSPSettingsPage | null>(null);
  const [draft, setDraft] = useState<DSPDraft | null>(null);
  const [inheritGlobal, setInheritGlobal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [validation, setValidation] = useState<{ fingerprint: string; result?: DSPValidation; error?: string } | null>(null);
  const [validationEpoch, setValidationEpoch] = useState(0);
  const request = useRef<AbortController | null>(null);
  const pending = useRef<{ key: string; request: DSPSaveRequest } | null>(null);
  const fingerprint = draft ? settingsFingerprint(settingsOf(draft)) : "";
  const valid = !!draft && !!data && validDraft(draft, data);
  const dirty = !!data && (inheritGlobal !== data.usesGlobal || (!inheritGlobal && fingerprint !== settingsFingerprint(data.settings)));

  useEffect(() => {
    const controller = new AbortController();
    void api.get(controller.signal).then(formatPage).then((page) => {
      if (controller.signal.aborted) return;
      setData(page); setDraft(draftOf(page.settings)); setInheritGlobal(page.usesGlobal); setLoading(false);
    }, (cause) => {
      if (!controller.signal.aborted) { setError(dspError(cause)); setLoading(false); }
    });
    return () => controller.abort();
  }, [api]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (refreshToken > 0) void reloadKeepingDraft(); }, [refreshToken]);
  useEffect(() => {
    if (!valid || !data?.available) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api.validate(JSON.parse(fingerprint), controller.signal).then((result) => {
        if (!controller.signal.aborted) setValidation({ fingerprint, result });
      }, (cause) => {
        if (!controller.signal.aborted) setValidation({ fingerprint, error: dspError(cause) });
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [api, fingerprint, valid, data?.available, validationEpoch]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function reloadKeepingDraft() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null);
    try {
      const page = formatPage(await api.get(controller.signal));
      if (controller.signal.aborted) return;
      setData(page); setDraft((current) => inheritGlobal ? draftOf(page.defaults) : !dirty || !current ? draftOf(page.settings) : current);
      if (!dirty) setInheritGlobal(page.usesGlobal);
      setConflict(false); setUncertain(false); pending.current = null;
      setMessage("已读取最新版本，草稿已保留。请检查后再次保存。");
      setValidation(null); setValidationEpoch((value) => value + 1);
    } catch (cause) { if (!controller.signal.aborted) setError(dspError(cause)); }
    finally { request.current = null; if (!controller.signal.aborted) { setBusy(false); setLoading(false); } }
  }

  async function save() {
    if (request.current || !data || !draft || conflict || !data.available) return;
    if (!pending.current) {
      if (!dirty || (!inheritGlobal && (!valid || validation?.fingerprint !== fingerprint || !validation.result))) return;
      pending.current = { key: crypto.randomUUID(), request: {
        expectedRevision: data.revision, schemaRevision: data.schemaRevision,
        ...(inheritGlobal ? { inheritGlobal: true } : { settings: settingsOf(draft) }),
      } };
    }
    const operation = pending.current;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null); setMessage("");
    try {
      const page = formatPage(await api.save(operation.request, operation.key, controller.signal));
      if (controller.signal.aborted) return;
      setData(page); setDraft(draftOf(page.settings)); setInheritGlobal(page.usesGlobal); pending.current = null; setUncertain(false);
      setMessage("格式转换设置已保存，下次播放时生效。");
      saved?.();
    } catch (cause) {
      if (controller.signal.aborted) return;
      const stale = cause instanceof ApiError && (cause.status === 409 || cause.status === 412 || cause.code === "REVISION_CONFLICT");
      const unknown = cause instanceof ApiError && (cause.status >= 500 || ["TIMEOUT", "NETWORK_ERROR", "INVALID_RESPONSE"].includes(cause.code));
      setConflict(stale); setUncertain(unknown);
      if (!unknown) pending.current = null;
      setError(stale ? "设置已在其他页面修改。你的草稿已保留，请读取最新版本后再次保存。" : dspError(cause));
    } finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }

  return {
    data, draft, setDraft, inheritGlobal, setInheritGlobal, loading, busy, error, message, conflict, uncertain, valid, dirty,
    validation: validation?.fingerprint === fingerprint ? validation : null,
    retryValidation: () => { setValidation(null); setValidationEpoch((value) => value + 1); },
    save, reloadKeepingDraft,
  };
}
