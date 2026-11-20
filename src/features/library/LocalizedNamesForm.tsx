import { useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { type LocalizedTitle, validLocalizedNames } from "../../api/localized-titles";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { LocalizedNamesEditor } from "./LocalizedNamesEditor";

export function LocalizedNamesForm({ names, initialNames, draftChanged, titleLabel, save, applied, refresh, busyChanged }: {
  names: LocalizedTitle[]; initialNames?: LocalizedTitle[]; draftChanged?: (names: LocalizedTitle[]) => void; titleLabel?: string;
  save: (names: LocalizedTitle[], key: string) => Promise<void>;
  applied: () => void; refresh: () => void; busyChanged: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState(initialNames ?? names);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [retryKey, setRetryKey] = useState<string>();
  const lock = useRef(false);
  const valid = validLocalizedNames(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(names);
  async function submit() {
    if (!valid || !dirty || lock.current || conflict) return;
    const key = retryKey ?? crypto.randomUUID();
    lock.current = true; setBusy(true); busyChanged(true); setError(null);
    try {
      await save(draft.map(({ language, title }) => ({ language: language.trim(), title: title.trim() })), key);
      applied();
    } catch (cause) {
      const uncertain = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
      setRetryKey(uncertain ? key : undefined);
      setConflict(cause instanceof ApiError && (cause.status === 409 || cause.status === 412));
      setError(uncertain ? tr("保存结果待确认，请重试或关闭后刷新。") : errorMessage(cause));
    } finally {
      lock.current = false; setBusy(false); busyChanged(false);
    }
  }
  return <form onSubmit={event => { event.preventDefault(); void submit(); }}>
    <LocalizedNamesEditor names={draft} titleLabel={titleLabel} onChange={value => {setDraft(value); draftChanged?.(value);}} disabled={busy || !!retryKey || conflict} />
    {!valid && <p className="muted">{tr("请填写有效的语言标签和名称，同一语言下的名称不能重复。")}</p>}
    <ErrorNotice error={error} />
    {conflict ? <button type="button" onClick={refresh}>{tr("刷新资料")}</button>
      : <button type="submit" className="primary" disabled={busy || !dirty || !valid}>{tr(retryKey ? "重试确认保存" : "保存")}</button>}
  </form>;
}
