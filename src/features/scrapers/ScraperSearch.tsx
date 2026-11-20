import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LocalizedTitle } from "../../api/localized-titles";
import { ApiError, errorMessage } from "../../api/client";
import { ScrapersApi, scraperSearchMessage, type ScrapeCandidate, type ScraperQuery } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { SearchForm } from "./SearchForm";
import { ScrapedPreview } from "./ScrapedPreview";
import "./scrapers.css";

export type ApplyCandidate = (field: string, pluginId: string, candidate: ScrapeCandidate, key: string) => Promise<void>;

export function ScraperSearch({ initial, preferredField, externalIds = [], allowedFields, apply, canApply, finished, refresh, savingChanged,
  titleOptions, fieldChanged, fieldControls, applyLabel }: {
  initial: ScraperQuery; preferredField: string; apply?: ApplyCandidate; canApply: (field: string, item: ScrapeCandidate) => boolean;
  externalIds?: { namespace: string; value: string }[];
  allowedFields?: readonly string[];
  titleOptions?: LocalizedTitle[];
  fieldChanged?: (field: string) => void;
  fieldControls?: (field: string) => ReactNode;
  applyLabel?: (field: string) => string;
  finished: () => void; refresh: () => void; savingChanged: (busy: boolean) => void;
}) {
  useLocale();
  const client = useServices().client;
  const api = useMemo(() => new ScrapersApi(client), [client]);
  const list = useResource("online-scrapers", (signal) => api.list(signal));
  const sources = list.data?.map((source) => allowedFields
    ? { ...source, fields: source.fields.filter((field) => allowedFields.includes(field)) } : source)
    .filter((source) => source.fields.length) ?? [];
  const [sourceId, setSourceId] = useState("");
  const [chosenField, setField] = useState(preferredField);
  const source = sources.find((item) => item.pluginId === sourceId)
    ?? sources.find((item) => item.available && item.fields.includes(preferredField) &&
      externalIds.some((id) => id.namespace === item.externalIdNamespace))
    ?? sources.find((item) => item.available && item.fields.includes(preferredField))
    ?? sources.find((item) => item.available) ?? sources[0];
  const field = source?.fields.includes(chosenField) ? chosenField : source?.fields[0] ?? "";
  useEffect(() => { fieldChanged?.(field); }, [field, fieldChanged]);
  const [query, setQuery] = useState(initial);
  const matchingIds = externalIds.filter((id) => id.namespace === source?.externalIdNamespace);
  const effectiveQuery = { ...query, externalId: query.externalId ?? (matchingIds.length === 1 ? matchingIds[0].value : undefined) };
  const [results, setResults] = useState<ScrapeCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<{ item: ScrapeCandidate; key: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const saveLock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  const reset = () => { setResults(null); setError(null); };
  async function search() {
    if (!source || !source.available || controller.current || saveLock.current || pending || conflict) return;
    const request = new AbortController();
    controller.current = request; reset(); setSearching(true);
    try {
      const items = await api.search(source.pluginId, field, effectiveQuery, request.signal);
      if (!request.signal.aborted) setResults(items);
    } catch (cause) {
      if (!request.signal.aborted) setError(scraperSearchMessage(cause, sources));
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setSearching(false);
    }
  }
  async function save(item: ScrapeCandidate) {
    if (!source || !apply || !canApply(field, item) || conflict || saveLock.current || pending && pending.item !== item) return;
    const key = pending?.key ?? crypto.randomUUID();
    saveLock.current = true; setSaving(true); savingChanged(true); setError(null);
    try {
      await apply(field, source.pluginId, item, key);
      if (mounted.current) finished();
    } catch (cause) {
      if (!mounted.current) return;
      const uncertain = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
      setPending(uncertain ? { item, key } : null);
      setConflict(cause instanceof ApiError && (cause.status === 409 || cause.status === 410));
      setError(uncertain ? tr("保存结果待确认，请重试或关闭后刷新。") : errorMessage(cause));
    } finally {
      saveLock.current = false;
      if (mounted.current) { setSaving(false); savingChanged(false); }
    }
  }
  return <div className="scraper-search">
    <ErrorNotice error={list.error} retry={list.reload} />
    {list.loading && <p role="status">{tr("正在加载…")}</p>}
    {list.data && !source && <p role="status">{tr("暂无在线刮削插件。")}</p>}
    {source && <SearchForm sources={sources} source={source} field={field} query={effectiveQuery} titleOptions={titleOptions}
      searching={searching} disabled={searching || saving || conflict || !!pending}
      changeQuery={(value) => { reset(); setQuery(value); }}
      changeSource={(id) => { reset(); setSourceId(id); setQuery((q) => ({ ...q, externalId: undefined })); }}
      changeField={(value) => { reset(); setField(value); setQuery((q) => ({ ...q, externalId: undefined })); }} submit={() => void search()}>
      {fieldControls?.(field)}
    </SearchForm>}
    <ErrorNotice error={error} />
    {conflict && <button onClick={refresh}>{tr("刷新资料")}</button>}
    {results?.length === 0 && <p role="status">{tr("没有匹配的资料。")}</p>}
    {!!results?.length && <div className="scraper-results">
      {results.map((item, index) => <details className="scraper-result" key={item.candidateToken} open={index === 0 || undefined}>
        <summary><strong>{item.title}</strong> · {item.id}</summary>
        <ScrapedPreview item={item} />
        {apply && canApply(field, item) && <button type="button" disabled={saving || conflict || !!pending && pending.item !== item}
          onClick={() => void save(item)}>{pending?.item === item ? tr("重试确认保存") : applyLabel?.(field) ?? tr("选用这项资料")}</button>}
      </details>)}
    </div>}
  </div>;
}
